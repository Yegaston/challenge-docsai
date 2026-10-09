import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const deriveKey = promisify(scrypt);

export function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  // v1 fixes scrypt's N=16384, r=8, p=1 and a 64-byte derived key.
  const key = await deriveKey(password, salt, 64) as Buffer;
  return `scrypt-v1$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, hash: string) {
  if (!validPassword(password) || !/^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(hash)) return false;
  const [, salt, expected] = hash.split("$");
  const actual = await deriveKey(password, Buffer.from(salt, "hex"), 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
