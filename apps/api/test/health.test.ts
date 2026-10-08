import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";

describe("GET /api/health", () => {
  it("reports a successful database check without caching", async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    const response = await request(createApp(check)).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", database: "reachable" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(check).toHaveBeenCalledOnce();
  });

  it("returns 503 without leaking database errors", async () => {
    const app = createApp(async () => { throw new Error("private connection details"); });
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: "degraded", database: "unreachable" });
    expect(response.text).not.toContain("private");
  });

  it("checks again after an outage rather than caching a failure", async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const app = createApp(check);
    expect((await request(app).get("/api/health")).status).toBe(503);
    expect((await request(app).get("/api/health")).status).toBe(200);
    expect(check).toHaveBeenCalledTimes(2);
  });
});
