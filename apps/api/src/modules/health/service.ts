import type { HealthRepository } from "./repository.js";

export function createHealthService(repository: HealthRepository) {
  return async () => {
    try {
      await repository.check();
      return { status: "ok", database: "reachable" } as const;
    } catch {
      return { status: "degraded", database: "unreachable" } as const;
    }
  };
}
