import { Pool } from "pg";
import { createTransferAgent, createTransferProvider } from "./modules/conversations/services/transfer-agent.js";
import { createTransfers } from "./modules/transfers/transfers.js";
import { createFixtureRepository, createFixtureRouter } from "./modules/transfers/fixtures.js";
import { createConversations } from "./modules/conversations/repositories/conversations.repository.js";
import { createConversationsService } from "./modules/conversations/services/conversations.service.js";
import { createConversationsRouter } from "./modules/conversations/http/controller.js";
import { createReportsRepository } from "./modules/reports/repositories/reports.repository.js";
import { createReportsService } from "./modules/reports/services/reports.service.js";
import { createAuditRepository } from "./modules/audit/repositories/audit.repository.js";
import { createAuditService } from "./modules/audit/services/audit.service.js";
import { createApp } from "./app.js";
import { createAuthRouter } from "./modules/auth/http/controller.js";
import { createAuthService } from "./modules/auth/services/auth.service.js";
import { createRefreshSessions } from "./modules/auth/repositories/refresh-sessions.repository.js";
import { createUsers } from "./modules/users/repositories/users.repository.js";
import { createHealthRepository } from "./modules/health/repositories/health.repository.js";
import { initializeUsers } from "./infrastructure/initialize-users.js";
import { createTickets } from "./modules/tickets/repositories/tickets.repository.js";
import { createTicketsService } from "./modules/tickets/services/tickets.service.js";
import { createTicketsRouter } from "./modules/tickets/http/controller.js";
import { createAnalyses } from "./modules/analyses/repositories/analyses.repository.js";
import { createAnalysesService } from "./modules/analyses/services/analyses.service.js";
import { createAnalysisProvider } from "./modules/analyses/utils/provider.js";
import { createTicketRetentionService } from "./modules/tickets/services/ticket-retention.service.js";
import { startTicketRetention } from "./infrastructure/ticket-retention.js";
import { createAuditRetention, startAuditRetention } from "./infrastructure/audit-retention.js";
import { createConversationRetention, startConversationRetention } from "./infrastructure/conversation-retention.js";
import { createConversationEscalation, startConversationEscalation } from "./infrastructure/conversation-escalation.js";

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
let tickets;
let conversations;
let stopRetention: (() => Promise<void>) | undefined;
let stopAuditRetention: (() => Promise<void>) | undefined;
let stopConversationRetention: (() => Promise<void>) | undefined;
let stopEscalation: (() => Promise<void>) | undefined;
let stopFixtures: (() => void) | undefined;
let stopRefresh: (() => void) | undefined;
let fixtures;
try {
  const refreshSessions = createRefreshSessions(pool);
  const authService = await createAuthService({ users: createUsers(pool), sessions: refreshSessions, secret: process.env.JWT_SECRET });
  auth = createAuthRouter(authService, { externalOrigin: process.env.AUTH_EXTERNAL_ORIGIN });
  const fixtureRepo = createFixtureRepository(pool);
  fixtures = createFixtureRouter(fixtureRepo, authService);
  const escalation = createConversationEscalation(pool);
  conversations = createConversationsRouter(createConversationsService(createConversations(pool), createTransferAgent(createTransferProvider(process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_MODEL), createTransfers(pool)), escalation), authService);
  const ticketsService = createTicketsService(createTickets(pool));
  const audit = createAuditService(createAuditRepository(pool));
  const analyses = createAnalysesService(createAnalyses(pool), ticketsService, createAnalysisProvider({
    apiKey: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL,
  }), audit);
  tickets = createTicketsRouter(ticketsService, authService, analyses, audit, createReportsService(createReportsRepository(pool)));
  await initializeUsers(pool, process.env.DEMO_EMAIL, process.env.DEMO_PASSWORD, process.env.SUPPORT_EMAIL, process.env.SUPPORT_PASSWORD);
  stopRetention = startTicketRetention(createTicketRetentionService(createTickets(pool)));
  stopAuditRetention = startAuditRetention(createAuditRetention(pool));
  stopConversationRetention = startConversationRetention(createConversationRetention(pool));
  stopEscalation = startConversationEscalation(escalation);
  void fixtureRepo.purge().catch(() => console.warn("Fixture retention sweep failed; will retry."));
  const fixtureTimer = setInterval(() => { void fixtureRepo.purge().catch(() => console.warn("Fixture retention sweep failed; will retry.")); }, 15 * 60 * 1000);
  stopFixtures = () => clearInterval(fixtureTimer);
  const purgeRefresh = () => { void refreshSessions.purge(new Date()).catch(() => console.warn("Refresh retention sweep failed; will retry.")); };
  purgeRefresh();
  const refreshTimer = setInterval(purgeRefresh, 15 * 60 * 1000);
  stopRefresh = () => clearInterval(refreshTimer);
} catch {
  // Startup errors may contain driver details or credentials: never print them.
  console.error("Authentication initialization failed. Check database access and DEMO_EMAIL, DEMO_PASSWORD, JWT_SECRET configuration (README.md).");
  await pool.end();
  process.exit(1);
}

const app = createApp(createHealthRepository(pool).check, auth, tickets, conversations, fixtures);
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on port ${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    // Best effort: stop between deletes; a stalled in-flight transaction may still hit this deadline.
    const deadline = setTimeout(() => process.exit(1), 5000);
    deadline.unref();
    server.close(() => {
      void (async () => {
        await stopRetention?.();
        await stopAuditRetention?.();
        await stopConversationRetention?.();
        await stopEscalation?.();
        stopFixtures?.();
        stopRefresh?.();
        await pool.end();
      })().then(() => {
        clearTimeout(deadline);
        process.exit(0);
      });
    });
  });
}
