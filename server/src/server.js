import { env } from "./config/env.js";
import { getDb, getMongoClient, closeDb } from "./config/db.js";
import app, { setupRoutes } from "./app.js";

// Models
import { healthModel } from "./models/health.model.js";
import { settingsModel } from "./models/settings.model.js";
import { userModel } from "./models/user.model.js";
import { invitationModel } from "./models/invitation.model.js";
import { cashierModel } from "./models/cashier.model.js";
import { tableModel } from "./models/table.model.js";
import { rateModel } from "./models/rate.model.js";
import { sessionModel } from "./models/session.model.js";
import { transactionModel } from "./models/transaction.model.js";

// Services
import { healthService } from "./services/health.service.js";
import { settingsService } from "./services/settings.service.js";
import { authService } from "./services/auth.service.js";
import { invitationService } from "./services/invitation.service.js";
import { cashierService } from "./services/cashier.service.js";
import { tableService } from "./services/table.service.js";
import { rateService } from "./services/rate.service.js";
import { sessionService } from "./services/session.service.js";
import { transactionService } from "./services/transaction.service.js";
import { reportService } from "./services/report.service.js";

// Controllers
import {
  healthController,
  settingsController,
  authController,
  invitationController,
  cashierController,
  tableController,
  rateController,
  sessionController,
  transactionController,
  reportController,
} from "./controllers/index.js";

const server = app.listen(env.PORT, async () => {
  // eslint-disable-next-line no-console
  console.log(`[gamehub] node backend listening on http://localhost:${env.PORT}`);
  try {
    const db = await getDb();
    const mongoClient = getMongoClient();

    // Wire up dependency graph: models → services → controllers → routes.
    const models = {
      health: healthModel({ db }),
      settings: settingsModel({ db }),
      user: userModel({ db }),
      invitation: invitationModel({ db }),
      cashier: cashierModel({ db }),
      table: tableModel({ db }),
      rate: rateModel({ db }),
      session: sessionModel({ db }),
      transaction: transactionModel({ db }),
    };

    const services = {
      health: healthService({ healthModel: models.health, dbName: env.MONGODB_DB }),
      settings: settingsService({
        settingsModel: models.settings,
        db,
        mongoClient,
        googleClientIdFromEnv: env.GOOGLE_CLIENT_ID,
      }),
      auth: authService({ userModel: models.user, db }),
      invitation: invitationService({
        invitationModel: models.invitation,
        db,
      }),
      cashier: cashierService({ cashierModel: models.cashier, db }),
      table: tableService({ tableModel: models.table, db }),
      rate: rateService({ rateModel: models.rate }),
      session: sessionService({
        sessionModel: models.session,
        tableModel: models.table,
        userModel: models.user,
        rateModel: models.rate,
        db,
      }),
      transaction: transactionService({
        transactionModel: models.transaction,
        sessionModel: models.session,
        db,
      }),
      report: reportService({ transactionModel: models.transaction }),
    };

    const controllers = {
      health: healthController({ healthService: services.health }),
      settings: settingsController({ settingsService: services.settings }),
      auth: authController({ authService: services.auth }),
      invitation: invitationController({ invitationService: services.invitation }),
      cashier: cashierController({ cashierService: services.cashier }),
      table: tableController({ tableService: services.table }),
      rate: rateController({ rateService: services.rate }),
      session: sessionController({ sessionService: services.session }),
      transaction: transactionController({ transactionService: services.transaction }),
      report: reportController({ reportService: services.report }),
    };

    setupRoutes(controllers);
    // eslint-disable-next-line no-console
    console.log("[gamehub] API routes wired");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[gamehub] failed to wire API routes:", err && err.message ? err.message : err);
  }
});

function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`[gamehub] ${signal} received, shutting down`);
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export default server;
