// Dependency wiring: DB → models → services → controllers → routes.
// Shared by server.js (HTTP listener) and the contract runner (in-process),
// so both exercise the exact same app.
import { env } from "./config/env.js";
import { getDb, getMongoClient } from "./config/db.js";
import { setupRoutes } from "./app.js";

// Models
import { healthModel } from "./models/health.model.js";
import { settingsModel } from "./models/settings.model.js";
import { userModel } from "./models/user.model.js";
import { invitationModel } from "./models/invitation.model.js";
import { cashierModel } from "./models/cashier.model.js";
import { tableModel } from "./models/table.model.js";
import { rateModel } from "./models/rate.model.js";
import { reservationModel } from "./models/reservation.model.js";
import { sessionModel } from "./models/session.model.js";
import { transactionModel } from "./models/transaction.model.js";
import { productModel } from "./models/product.model.js";
import { activityModel } from "./models/activity.model.js";

// Services
import { healthService } from "./services/health.service.js";
import { settingsService } from "./services/settings.service.js";
import { authService } from "./services/auth.service.js";
import { invitationService } from "./services/invitation.service.js";
import { cashierService } from "./services/cashier.service.js";
import { tableService } from "./services/table.service.js";
import { rateService } from "./services/rate.service.js";
import { sessionService } from "./services/session.service.js";
import { reservationService } from "./services/reservation.service.js";
import { googleCalendarService } from "./services/googleCalendar.service.js";
import { mailService } from "./services/mail.service.js";
import { recaptchaService } from "./services/recaptcha.service.js";
import { paymongoService } from "./services/paymongo.service.js";
import { transactionService } from "./services/transaction.service.js";
import { reportService } from "./services/report.service.js";
import { productService } from "./services/product.service.js";
import { orderService } from "./services/order.service.js";
import { activityService } from "./services/activity.service.js";

// Controllers
import {
  healthController,
  settingsController,
  authController,
  invitationController,
  cashierController,
  tableController,
  rateController,
  reservationController,
  sessionController,
  transactionController,
  reportController,
  productController,
  orderController,
  activityController,
} from "./controllers/index.js";

let wired = false;
let wiredGraph = null;

/**
 * Connect to Mongo, build the dependency graph and mount /api routes.
 * Safe to call once per process; repeat calls return the same graph.
 */
export async function wireApp() {
  if (wired) return wiredGraph;
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
    reservation: reservationModel({ db }),
    session: sessionModel({ db }),
    transaction: transactionModel({ db }),
    product: productModel({ db }),
    activity: activityModel({ db }),
  };

  const mailer = mailService({
    user: env.MAIL_USER,
    pass: env.MAIL_PASS,
    from: env.MAIL_FROM,
    dryRun: env.MAIL_DRY_RUN,
  });
  if (env.MAIL_DRY_RUN) {
    // eslint-disable-next-line no-console
    console.log("[gamehub] mail DRY-RUN enabled (no real email will be sent)");
  } else if (!mailer.enabled) {
    // eslint-disable-next-line no-console
    console.log("[gamehub] mail disabled (set MAIL_USER/MAIL_PASS to send email)");
  }

  const sessionSvc = sessionService({
    sessionModel: models.session,
    tableModel: models.table,
    userModel: models.user,
    rateModel: models.rate,
    db,
  });
  const settingsSvc = settingsService({
    settingsModel: models.settings,
    db,
    mongoClient,
    googleClientIdFromEnv: env.GOOGLE_CLIENT_ID,
    googleCalendarFromEnv: {
      calendarId: env.GOOGLE_CALENDAR_ID,
      clientEmail: env.GOOGLE_CALENDAR_CLIENT_EMAIL,
      privateKey: env.GOOGLE_CALENDAR_PRIVATE_KEY,
    },
    settingsEncryptionKey: env.SETTINGS_ENCRYPTION_KEY,
    recaptchaFromEnv: {
      siteKey: env.RECAPTCHA_SITE_KEY,
      secretKey: env.RECAPTCHA_SECRET_KEY,
    },
  });
  const paymongo = paymongoService({
    configProvider: () => settingsSvc.paymongoConfig(),
    frontendUrl: env.FRONTEND_URL,
  });
  const services = {
    health: healthService({ healthModel: models.health, dbName: env.MONGODB_DB }),
    settings: settingsSvc,
    paymongo,
    invitation: invitationService({
      invitationModel: models.invitation,
      db,
      mailer,
    }),
    cashier: cashierService({ cashierModel: models.cashier, db }),
    table: tableService({ tableModel: models.table, db }),
    rate: rateService({ rateModel: models.rate }),
    session: sessionSvc,
    transaction: transactionService({
      transactionModel: models.transaction,
      sessionModel: models.session,
      sessionService: sessionSvc,
      db,
      paymongoService: paymongo,
    }),
    report: reportService({ transactionModel: models.transaction }),
    product: productService({ productModel: models.product, db }),
    activity: activityService({
      activityModel: models.activity,
      userModel: models.user,
    }),
  };

  // reCAPTCHA is DB-backed (settings.recaptcha) with env fallback while no
  // document exists. Verification is a no-op when the integration is off.
  const recaptcha = recaptchaService({
    configProvider: () => services.settings.recaptchaConfig(),
  });
  services.recaptcha = recaptcha;
  services.auth = authService({
    userModel: models.user,
    settingsModel: models.settings,
    db,
    googleClientIdFromEnv: env.GOOGLE_CLIENT_ID,
    recaptchaService: recaptcha,
  });

  // Calendar sync is DB-backed (settings.googleCalendar), with env fallback
  // when no document exists. It is always present; methods no-op when disabled.
  const calendar = {
    enabled: true,
    async createReservationEvent(reservation) {
      const cfg = await services.settings.calendarConfig();
      if (!cfg.enabled) return "";
      const svc = googleCalendarService(cfg);
      return svc.createReservationEvent(reservation);
    },
    async deleteReservationEvent(eventId) {
      const cfg = await services.settings.calendarConfig();
      if (!cfg.enabled || !eventId) return false;
      const svc = googleCalendarService(cfg);
      return svc.deleteReservationEvent(eventId);
    },
  };
  services.calendar = calendar;
  services.reservation = reservationService({
    reservationModel: models.reservation,
    tableModel: models.table,
    db,
    calendarService: calendar,
    mailer,
    recaptchaService: recaptcha,
  });
  services.order = orderService({
    sessionModel: models.session,
    productModel: models.product,
    transactionModel: models.transaction,
    sessionService: sessionSvc,
    db,
  });

  const controllers = {
    health: healthController({ healthService: services.health }),
    settings: settingsController({ settingsService: services.settings }),
    auth: authController({ authService: services.auth }),
    invitation: invitationController({ invitationService: services.invitation }),
    cashier: cashierController({ cashierService: services.cashier }),
    table: tableController({ tableService: services.table }),
    rate: rateController({ rateService: services.rate }),
    reservation: reservationController({ reservationService: services.reservation }),
    session: sessionController({ sessionService: services.session }),
    transaction: transactionController({ transactionService: services.transaction }),
    report: reportController({ reportService: services.report }),
    product: productController({ productService: services.product }),
    order: orderController({ orderService: services.order }),
    activity: activityController({ activityService: services.activity }),
  };

  setupRoutes(controllers);
  wired = true;
  wiredGraph = { models, services, controllers };
  return wiredGraph;
}
