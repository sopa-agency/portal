import "server-only";
// Thin TS wrapper over secret-box.cjs so server actions and the worker share
// one implementation (AES-256-GCM). See the .cjs for format + key derivation.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const box = require("./secret-box.cjs") as {
  encrypt: (plaintext: string) => string;
  decrypt: (blob: string) => string | null;
};

export function encryptSecret(plaintext: string): string {
  return box.encrypt(plaintext);
}
export function decryptSecret(blob: string): string | null {
  return box.decrypt(blob);
}
