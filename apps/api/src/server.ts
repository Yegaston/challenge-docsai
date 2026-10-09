import { Pool } from "pg";
import { createApp } from "./app.js";
import { createAuthRouter } from "./modules/auth/http/controller.js";
import { createAuthService } from "./modules/auth/service.js";
import { createUsers } from "./modules/users/repository.js";
import { createHealthRepository } from "./modules/health/repository.js";
import { initializeUsers } from "./infrastructure/initialize-users.js";

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

let auth;
try {
  auth = createAuthRouter(await createAuthService({ users: createUsers(pool), secret: process.env.JWT_SECRET }));
  await initializeUsers(pool, process.env.DEMO_EMAIL, process.env.DEMO_PASSWORD);
} catch {
  // Startup errors may contain driver details or credentials: never print them.
  console.error("Authentication initialization failed. Check database access and DEMO_EMAIL, DEMO_PASSWORD, JWT_SECRET configuration (README.md).");
  await pool.end();
  process.exit(1);
}

const app = createApp(createHealthRepository(pool).check, auth);
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
