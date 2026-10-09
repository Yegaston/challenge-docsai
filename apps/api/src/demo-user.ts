import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const deriveKey = promisify(scrypt);
export type User = { id: string; email: string; password_hash: string };
type Database = { query(sql: string, values?: unknown[]): Promise<{ rows: User[] }> };
export type Users = ReturnType<typeof createUsers>;

export function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 254) return;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

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

export function createUsers(database: Database) {
  return {
    async byEmail(email: string) {
      return (await database.query("SELECT id, email, password_hash FROM users WHERE email = $1", [email])).rows[0];
    },
    async byId(id: string) {
      return (await database.query("SELECT id, email, password_hash FROM users WHERE id = $1", [id])).rows[0];
    },
  };
}

export async function seedDemoUser(database: Database, emailValue: unknown, password: unknown) {
  const email = normalizeEmail(emailValue);
  if (!email || !validPassword(password) || password.length < 12) {
    throw new Error("DEMO_EMAIL and DEMO_PASSWORD (12–256 characters) are required. See README.md.");
  }
  // Run on every API startup, not only PostgreSQL's first-volume initialization.
  const schema = await readFile(new URL("../migrations/001-users.sql", import.meta.url), "utf8");
  await database.query(schema);
  await database.query(
    "INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING",
    [randomUUID(), email, await hashPassword(password)],
  );
}
