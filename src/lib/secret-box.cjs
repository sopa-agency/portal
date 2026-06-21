// AES-256-GCM secret box for at-rest secrets (Hive posting keys in the trail
// registry). Shared by the worker (require) and server actions (TS wrapper in
// secret-box.ts re-exports these). Key derives from TRAIL_SECRET_KEY (fallback
// SESSION_SECRET) — set a dedicated TRAIL_SECRET_KEY in prod.
//
// Format: base64( iv(12) | authTag(16) | ciphertext ). Returns null on failure
// rather than throwing, so a bad/rotated key never crashes a caller.
"use strict";
const crypto = require("node:crypto");

function keyMaterial() {
  const raw = process.env.TRAIL_SECRET_KEY || process.env.SESSION_SECRET;
  if (!raw) throw new Error("TRAIL_SECRET_KEY/SESSION_SECRET not set");
  return crypto.createHash("sha256").update(String(raw)).digest(); // 32 bytes
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyMaterial(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

function decrypt(blob) {
  try {
    const buf = Buffer.from(String(blob), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyMaterial(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

module.exports = { encrypt, decrypt };
