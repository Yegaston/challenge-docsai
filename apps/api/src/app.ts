import express from "express";
import { createHealthRouter } from "./modules/health/http/controller.js";
import { createHealthService } from "./modules/health/service.js";

export function createApp(checkDatabase: () => Promise<void>, auth?: express.Router) {
  const app = express();
  app.disable("x-powered-by");
  app.use("/api/health", createHealthRouter(createHealthService({ check: checkDatabase })));
  if (auth) app.use("/api/auth", auth);
  return app;
}
