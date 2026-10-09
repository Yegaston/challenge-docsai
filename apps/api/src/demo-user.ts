// Compatibility exports for the accepted Task 2 API; feature ownership lives in modules.
export { createUsers, type User, type Users } from "./modules/users/repositories/users.repository.js";
export { normalizeEmail } from "./modules/users/services/users.service.js";
export { hashPassword, validPassword, verifyPassword } from "./modules/auth/utils/password.js";
export { initializeUsers as seedDemoUser } from "./infrastructure/initialize-users.js";
