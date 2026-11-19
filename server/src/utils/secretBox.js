// AES-256-GCM secret storage for `settings` credentials marked `secret: true`.
// migration.md §13.6 / TechnicalRequirements-01 §9.2: never store a plaintext
// secret credential. `SETTINGS_ENCRYPTION_KEY` must be 32 bytes (64 hex chars).
import crypto from "node:crypto";

const ALG = "aes-256-gcm";
const IV_BYTES = 12;

function parseKey(keyHex) {
  const raw = String(keyHex || "").trim();
  if (raw === "") return null;
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY must be 64 hex characters (32 bytes); generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(raw, "hex");
}

export function createSecretBox(keyHex) {
  const key = parseKey(keyHex);

  return {
    configured: key !== null,

    /** Returns a storable credential object (no plaintext value). */
    encrypt(plain) {
      if (!key) throw new Error("SETTINGS_ENCRYPTION_KEY is not configured");
      const iv = crypto.randomBytes(IV_BYTES);
      const cipher = crypto.createCipheriv(ALG, key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(String(plain), "utf8"),
        cipher.final(),
      ]);
      return {
        alg: ALG,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      };
    },

    /** Returns "" when the key is missing or the payload cannot be authenticated. */
    decrypt(raw) {
      if (!key || !raw || raw.alg !== ALG) return "";
      try {
        const decipher = crypto.createDecipheriv(
          ALG,
          key,
          Buffer.from(String(raw.iv || ""), "base64")
        );
        decipher.setAuthTag(Buffer.from(String(raw.tag || ""), "base64"));
        return Buffer.concat([
          decipher.update(Buffer.from(String(raw.ciphertext || ""), "base64")),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        return "";
      }
    },
  };
}
