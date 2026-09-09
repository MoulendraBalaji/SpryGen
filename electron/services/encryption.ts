import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import * as os from "node:os";

// AES-256-GCM. The key is derived from SPRYGEN_DB_ENCRYPTION_KEY when set;
// otherwise a deterministic machine-bound passphrase is used so the local
// database stays readable across restarts without user setup.
function deriveKey(): Buffer {
  const pass =
    process.env.SPRYGEN_DB_ENCRYPTION_KEY ||
    `sprygen-local-${os.userInfo().username}-${os.homedir()}`;
  return scryptSync(pass, "sprygen-salt-v1", 32);
}

const IV_LEN = 12;
const TAG_LEN = 16;

export function encrypt(value: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}