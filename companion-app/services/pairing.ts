import { useState, useCallback } from "react";

const PAIRING_PORT = 8765;

// Per-device bearer token issued by the desktop on a successful `/pair`.
// Kept in memory for the lifetime of the app session and reused for every
// authenticated request: `/capture` and the notification WebSocket upgrade.
let deviceToken: string | null = null;
let desktopHost: string | null = null;

export function getDeviceToken(): string | null {
  return deviceToken;
}

export function getDesktopBaseUrl(): string | null {
  return desktopHost ? `http://${desktopHost}:${PAIRING_PORT}` : null;
}

/** Headers to attach to every authenticated request to the desktop. */
export function authHeaders(): Record<string, string> {
  return deviceToken ? { Authorization: `Bearer ${deviceToken}` } : {};
}

export function usePairing() {
  const [paired, setPaired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const pairWithHost = useCallback(async (host: string, code: string) => {
    setLoading(true);
    setError(null);

    const cleanHost = host.trim().replace(/^https?:\/\//, "").replace(/:\d+$/, "");
    const url = `http://${cleanHost}:${PAIRING_PORT}/pair`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() })
      });

      const data = await res.json();
      if (res.ok && data.success && typeof data.token === "string") {
        // Store the per-device token; it is required for /capture and the WebSocket.
        deviceToken = data.token;
        desktopHost = cleanHost;
        setPaired(true);
        setLoading(false);
        return true;
      } else {
        setError(data.message || "Invalid pairing PIN");
        setLoading(false);
        return false;
      }
    } catch (err) {
      setError(`Connection failed: Check IP & ensure SPRYGEN desktop is running.`);
      setLoading(false);
      return false;
    }
  }, []);

  return { paired, error, loading, pairWithHost };
}
