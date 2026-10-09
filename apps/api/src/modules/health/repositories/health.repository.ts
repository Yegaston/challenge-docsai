export type HealthRepository = { check(): Promise<void> };
type Database = { query(sql: string): Promise<unknown> };

export function createHealthRepository(database: Database): HealthRepository {
  return { async check() { await database.query("SELECT 1"); } };
}
