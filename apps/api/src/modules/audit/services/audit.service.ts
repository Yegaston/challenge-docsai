import type { AuditEvent, AuditRepository } from "../repositories/audit.repository.js";

export function createAuditService(repository: AuditRepository, diagnostic: () => void = () => {
  console.error("Audit event unavailable.");
}) {
  return {
    // Audit availability must never affect an already successful owner operation.
    async record(event: AuditEvent): Promise<void> {
      try {
        await repository.insert(event);
      } catch {
        try { diagnostic(); } catch { /* Diagnostics are best effort too. */ }
      }
    },
  };
}
export type AuditService = ReturnType<typeof createAuditService>;
