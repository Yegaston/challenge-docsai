import { createAuthRouter } from "./modules/auth/http/controller.js";
import { createAuthService } from "./modules/auth/services/auth.service.js";

// Compatibility facade; startup composes the service and HTTP controller explicitly.
export async function createAuth(options: Parameters<typeof createAuthService>[0]) {
  return createAuthRouter(await createAuthService(options));
}
