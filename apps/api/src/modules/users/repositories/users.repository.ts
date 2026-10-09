export type User = { id: string; email: string; password_hash: string };
export type Users = {
  byEmail(email: string): Promise<User | undefined>;
  byId(id: string): Promise<User | undefined>;
};
export type UserSeedRepository = { insert(user: User): Promise<void> };

type Database = { query(sql: string, values?: unknown[]): Promise<{ rows: User[] }> };

export function createUsers(database: Database): Users & UserSeedRepository {
  return {
    async byEmail(email) {
      return (await database.query("SELECT id, email, password_hash FROM users WHERE email = $1", [email])).rows[0];
    },
    async byId(id) {
      return (await database.query("SELECT id, email, password_hash FROM users WHERE id = $1", [id])).rows[0];
    },
    async insert(user) {
      await database.query(
        "INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING",
        [user.id, user.email, user.password_hash],
      );
    },
  };
}
