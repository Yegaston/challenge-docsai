import express from "express";

export function createApp(checkDatabase: () => Promise<void>, auth?: express.Router) {
  const app = express();
  app.disable("x-powered-by");

  app.get("/api/health", async (_request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      await checkDatabase();
      response.json({ status: "ok", database: "reachable" });
    } catch {
      // Never expose connection strings or database error details to clients.
      response.status(503).json({ status: "degraded", database: "unreachable" });
    }
  });

  if (auth) app.use("/api/auth", auth);
  return app;
}
