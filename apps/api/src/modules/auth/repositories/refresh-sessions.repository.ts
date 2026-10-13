export type RefreshSessions = {
  create(hash: string, ownerId: string, createdAt: Date, expiresAt: Date): Promise<void>;
  byHash(hash: string): Promise<{ ownerId: string; expiresAt: Date } | undefined>;
  revoke(hash: string): Promise<void>;
  purge(now: Date): Promise<void>;
};

type Client = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; release(): void };
type Database = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; connect(): Promise<Client> };

export function createRefreshSessions(database: Database): RefreshSessions {
  return {
    async create(hash, ownerId, createdAt, expiresAt) {
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        // Serialize concurrent logins for this owner before applying the cap.
        await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [ownerId]);
        await client.query("INSERT INTO refresh_sessions (secret_hash, owner_id, created_at, expires_at) VALUES ($1, $2, $3, $4)", [hash, ownerId, createdAt, expiresAt]);
        await client.query(`DELETE FROM refresh_sessions WHERE secret_hash IN (
          SELECT secret_hash FROM refresh_sessions WHERE owner_id = $1
          ORDER BY created_at DESC, secret_hash DESC OFFSET 10
        )`, [ownerId]);
        await client.query("COMMIT");
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch { /* preserve the original failure */ }
        throw error;
      } finally {
        client.release();
      }
    },
    async byHash(hash) {
      const row = (await database.query("SELECT owner_id, expires_at FROM refresh_sessions WHERE secret_hash = $1", [hash])).rows[0];
      return row ? { ownerId: String(row.owner_id), expiresAt: row.expires_at as Date } : undefined;
    },
    async revoke(hash) {
      await database.query("DELETE FROM refresh_sessions WHERE secret_hash = $1", [hash]);
    },
    async purge(now) {
      await database.query(`DELETE FROM refresh_sessions WHERE secret_hash IN (
        SELECT secret_hash FROM refresh_sessions WHERE expires_at <= $1 ORDER BY expires_at LIMIT 100
      )`, [now]);
    },
  };
}
