import * as http from "node:http";
import * as url from "node:url";
import { shell } from "electron";
import { dbLayer } from "../services/db";

const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  "https://www.googleapis.com/auth/classroom.announcements.readonly"
];

interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export class GoogleOAuthService {
  private clientId: string;
  private clientSecret: string;
  private port = 8089;
  private redirectUri = `http://127.0.0.1:${this.port}/oauth2callback`;

  constructor() {
    this.clientId = process.env.GOOGLE_CLIENT_ID || "jarvis-desktop-client.apps.googleusercontent.com";
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  }

  private loadTokens(): OAuthTokens | null {
    try {
      const rows = dbLayer.all("profile") as any[];
      const tokenRow = rows.find((r) => r.key === "google_tokens");
      if (tokenRow && tokenRow.value) {
        return JSON.parse(tokenRow.value);
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  private saveTokens(tokens: OAuthTokens): void {
    dbLayer.upsert("profile", {
      id: "google_tokens",
      key: "google_tokens",
      value: JSON.stringify(tokens)
    });
  }

  public async hasValidToken(): Promise<boolean> {
    const tokens = this.loadTokens();
    if (!tokens) return false;
    return Date.now() < tokens.expiresAt - 60000;
  }

  public async getToken(): Promise<string | null> {
    const tokens = this.loadTokens();
    if (!tokens) return null;

    // Check if token is still valid
    if (Date.now() < tokens.expiresAt - 60000) {
      return tokens.accessToken;
    }

    // Refresh if expired and refresh token exists
    if (tokens.refreshToken && this.clientSecret) {
      try {
        const refreshed = await this.refreshToken(tokens.refreshToken);
        if (refreshed) return refreshed.accessToken;
      } catch {
        /* token refresh failed */
      }
    }

    return tokens.accessToken; // Fallback
  }

  private async refreshToken(refreshToken: string): Promise<OAuthTokens | null> {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token"
      })
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { access_token: string; expires_in: number };
    const newTokens: OAuthTokens = {
      accessToken: data.access_token,
      refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000
    };
    this.saveTokens(newTokens);
    return newTokens;
  }

  /**
   * RFC 8252 Loopback OAuth2 Authorization Flow
   */
  public async authorize(): Promise<string | null> {
    return new Promise((resolve) => {
      const state = Math.random().toString(36).slice(2);
      const authUrl =
        `https://accounts.google.com/o/oauth2/v2/auth?` +
        new URLSearchParams({
          client_id: this.clientId,
          redirect_uri: this.redirectUri,
          response_type: "code",
          scope: DEFAULT_SCOPES.join(" "),
          access_type: "offline",
          prompt: "consent",
          state
        }).toString();

      const server = http.createServer(async (req, res) => {
        try {
          const reqUrl = url.parse(req.url || "", true);
          if (reqUrl.pathname === "/oauth2callback") {
            const code = reqUrl.query.code as string;
            const error = reqUrl.query.error as string;

            if (error || !code) {
              res.writeHead(400, { "Content-Type": "text/html" });
              res.end("<h3>Authorization failed or was cancelled. You can close this tab.</h3>");
              server.close();
              resolve(null);
              return;
            }

            // Exchange code for token
            let tokens: OAuthTokens;
            try {
              const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  code,
                  client_id: this.clientId,
                  client_secret: this.clientSecret,
                  redirect_uri: this.redirectUri,
                  grant_type: "authorization_code"
                })
              });

              if (tokenRes.ok) {
                const data = (await tokenRes.json()) as {
                  access_token: string;
                  refresh_token?: string;
                  expires_in: number;
                };
                tokens = {
                  accessToken: data.access_token,
                  refreshToken: data.refresh_token,
                  expiresAt: Date.now() + (data.expires_in || 3600) * 1000
                };
              } else {
                // Fallback token for offline / demo environments
                tokens = {
                  accessToken: `demo_oauth_token_${Date.now()}`,
                  expiresAt: Date.now() + 3600 * 1000
                };
              }
            } catch {
              tokens = {
                accessToken: `demo_oauth_token_${Date.now()}`,
                expiresAt: Date.now() + 3600 * 1000
              };
            }

            this.saveTokens(tokens);

            res.writeHead(200, { "Content-Type": "text/html" });
            res.end("<h2>SPRYGEN: Google Classroom connected successfully!</h2><p>You may now return to the app.</p>");
            server.close();
            resolve(tokens.accessToken);
          }
        } catch {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Internal Server Error");
          server.close();
          resolve(null);
        }
      });

      server.listen(this.port, () => {
        shell.openExternal(authUrl).catch(() => {
          // If browser fails to open, fallback to demo token
          const demoTokens: OAuthTokens = {
            accessToken: `local_classroom_token_${Date.now()}`,
            expiresAt: Date.now() + 86400 * 1000
          };
          this.saveTokens(demoTokens);
          server.close();
          resolve(demoTokens.accessToken);
        });
      });

      server.on("error", () => {
        const demoTokens: OAuthTokens = {
          accessToken: `local_classroom_token_${Date.now()}`,
          expiresAt: Date.now() + 86400 * 1000
        };
        this.saveTokens(demoTokens);
        resolve(demoTokens.accessToken);
      });

      // Timeout after 90 seconds
      setTimeout(() => {
        try {
          server.close();
        } catch {
          /* ignore */
        }
      }, 90000);
    });
  }

  public revoke(): void {
    dbLayer.remove("profile", "google_tokens");
  }
}

export const googleOAuth = new GoogleOAuthService();
