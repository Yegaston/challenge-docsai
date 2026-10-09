import type { UserSeedRepository } from "./repository.js";

export function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 254) return;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

export function validateSeed(emailValue: unknown, password: unknown) {
  const email = normalizeEmail(emailValue);
  if (!email || typeof password !== "string" || password.length < 12 || password.length > 256) {
    throw new Error("DEMO_EMAIL and DEMO_PASSWORD (12–256 characters) are required. See README.md.");
  }
  return { email, password };
}

export async function seedDemoUser(
  repository: UserSeedRepository, emailValue: unknown, passwordValue: unknown,
  dependencies: { hash(password: string): Promise<string>; id(): string },
) {
  const { email, password } = validateSeed(emailValue, passwordValue);
  await repository.insert({ id: dependencies.id(), email, password_hash: await dependencies.hash(password) });
}
