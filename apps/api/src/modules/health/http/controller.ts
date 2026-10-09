import { Router } from "express";
import type { createHealthService } from "../services/health.service.js";

export function createHealthRouter(check: ReturnType<typeof createHealthService>) {
  const router = Router();
  router.get("/", async (_request, response) => {
    response.set("Cache-Control", "no-store");
    const result = await check();
    // Never expose connection strings or database error details to clients.
    response.status(result.status === "ok" ? 200 : 503).json(result);
  });
  return router;
}
