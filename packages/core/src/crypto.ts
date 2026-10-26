import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  randomUUID,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { config } from "./config.js";

/**
 * Hash de contrasena usando scrypt (incluido en Node, sin dependencias nativas).
 * Formato almacenado: scrypt$<saltHex>$<hashHex>
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function newId(): string {
  return randomUUID();
}

/**
 * Cifrado REVERSIBLE (AES-256-GCM) para secretos que el core necesita volver a
 * usar en claro, p.ej. la contrasena de una conexion SMB.
 *
 * La clave se deriva del jwtSecret del core con scrypt. Formato almacenado:
 *   enc$<ivHex>$<tagHex>$<cipherHex>
 *
 * Nota: la seguridad depende de WTM_JWT_SECRET. En produccion conviene fijar
 * un secreto fuerte por variable de entorno.
 */
const ENC_KEY = scryptSync(config.jwtSecret, "wtm-secret-box", 32);

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc$${iv.toString("hex")}$${tag.toString("hex")}$${enc.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "enc") {
    // Compatibilidad: si no esta cifrado, lo devolvemos tal cual.
    return stored;
  }
  const iv = Buffer.from(parts[1], "hex");
  const tag = Buffer.from(parts[2], "hex");
  const data = Buffer.from(parts[3], "hex");
  const decipher = createDecipheriv("aes-256-gcm", ENC_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
