import { Pool } from "pg";
import { createApp } from "./app.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. See README.md for local setup.");
}

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 2000,
  statement_timeout: 2000,
  query_timeout: 2500,
  max: 5,
});
pool.on("error", () => console.error("An idle database connection failed."));

const app = createApp(async () => {
  await pool.query("SELECT 1");
});
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on port ${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    const deadline = setTimeout(() => process.exit(1), 5000);
    deadline.unref();
    server.close(() => {
      void pool.end().then(() => {
        clearTimeout(deadline);
        process.exit(0);
      });
    });
  });
}
