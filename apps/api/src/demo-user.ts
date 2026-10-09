// Compatibility exports for the accepted Task 2 API; feature ownership lives in modules.
export { createUsers, type User, type Users } from "./modules/users/repository.js";
export { normalizeEmail } from "./modules/users/service.js";
export { hashPassword, validPassword, verifyPassword } from "./modules/auth/password.js";
export { initializeUsers as seedDemoUser } from "./infrastructure/initialize-users.js";
