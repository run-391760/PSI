import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AppError } from "@/lib/domain";

/**
 * Symmetric encryption for secrets stored in the database (OAuth refresh tokens).
 * Key: SHA-256 of APP_SECRET. In development, a random secret is generated once into .data/app-secret;
 * production must set APP_SECRET (tokens become unreadable if it changes).
 */
let cachedKey: Buffer | null = null;
function key() {
  if (cachedKey) return cachedKey;
  let secret = process.env.APP_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") throw new AppError("Set APP_SECRET (a long random string) before connecting accounts.", 500);
    const file = path.join(process.cwd(), ".data", "app-secret");
    try {
      secret = readFileSync(file, "utf8").trim();
    } catch {
      secret = randomBytes(32).toString("hex");
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, secret, { mode: 0o600 });
    }
  }
  cachedKey = createHash("sha256").update(secret).digest();
  return cachedKey;
}

/** AES-256-GCM. Output: base64(iv).base64(tag).base64(ciphertext). */
export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(encoded: string) {
  const [iv, tag, data] = encoded.split(".").map((p) => Buffer.from(p, "base64"));
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError("A stored credential could not be decrypted (APP_SECRET changed?). Reconnect the account.", 409);
  }
}
