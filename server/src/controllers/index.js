// Controllers — HTTP in/out only. Parse/validate input, call a service, send
// through a view. No DB queries. migration.md §9 layer rules.
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/HttpError.js";
import {
  healthView,
  loginView,
  meView,
  publicConfigView,
  adminIntegrationsView,
  invitationCheckView,
  activityView,
} from "../views/index.js";

// -------- Tables --------
export function tableController({ tableService }) {
  return {
    list: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const result = await tableService.list({ status: req.query.status });
      res.status(200).json(result);
    }),

    add: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const { name } = req.body || {};
      const result = await tableService.add(name);
      res.status(200).json(result);
    }),

    rename: asyncHandler(async (req, res) => {
      const { id } = req.params || {};
      if (!id) throw new HttpError(422, "invalid id");
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const { name } = req.body || {};
      const result = await tableService.rename(id, name);
      res.status(200).json(result);
    }),

    status: asyncHandler(async (req, res) => {
      const { id } = req.params || {};
      if (!id) throw new HttpError(422, "invalid id");
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const { status } = req.body || {};
      const result = await tableService.status(id, status);
      res.status(200).json(result);
    }),

    archive: asyncHandler(async (req, res) => {
      const { id } = req.params || {};
      if (!id) throw new HttpError(422, "invalid id");
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const result = await tableService.archive(id);
      res.status(200).json(result);
    }),

    unarchive: asyncHandler(async (req, res) => {
      const { id } = req.params || {};
      if (!id) throw new HttpError(422, "invalid id");
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const result = await tableService.unarchive(id);
      res.status(200).json(result);
    }),

    publicList: asyncHandler(async (req, res) => {
      const result = await tableService.publicList();
      res.status(200).json(result);
    }),

    cashierList: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user) {
        throw new HttpError(401, "not logged in");
      }
      const result = await tableService.cashierList({ status: req.query.status });
      res.status(200).json(result);
    }),
  };
}

// -------- Rates --------
export function rateController({ rateService }) {
  return {
    list: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const result = await rateService.list();
      res.status(200).json(result);
    }),

    set: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const result = await rateService.set(req.body || {});
      res.status(200).json(result);
    }),

    publicList: asyncHandler(async (req, res) => {
      const result = await rateService.list();
      res.status(200).json(result);
    }),
  };
}

// -------- Sessions --------
export function sessionController({ sessionService }) {
  return {
    list: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user) {
        throw new HttpError(401, "not logged in");
      }
      const result = await sessionService.list({
        status: req.query.status,
      });
      res.status(200).json(result);
    }),

    start: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user) {
        throw new HttpError(401, "not logged in");
      }
      const result = await sessionService.start(
        {
          tableId: req.body?.tableId,
          customerName: req.body?.customerName,
          durationMinutes: req.body?.durationMinutes,
          hours: req.body?.hours,
          minutes: req.body?.minutes,
        },
        user
      );
      res.status(200).json(result);
    }),

    extend: asyncHandler(async (req, res) => {
      const { id } = req.params || {};
      if (!id) throw new HttpError(422, "invalid id");
      const user = req.session && req.session.user;
      if (!user) {
        throw new HttpError(401, "not logged in");
      }
      const result = await sessionService.extend(
        id,
        req.body?.extraMinutes,
        req.body?.minutes,
        user
      );
      res.status(200).json(result);
    }),

    end: asyncHandler(async (req, res) => {
      const { id } = req.params || {};
      if (!id) throw new HttpError(422, "invalid id");
      const user = req.session && req.session.user;
      if (!user) {
        throw new HttpError(401, "not logged in");
      }
      const result = await sessionService.end(id, user);
      res.status(200).json(result);
    }),

    cancel: asyncHandler(async (req, res) => {
      const { id } = req.params || {};
      if (!id) throw new HttpError(422, "invalid id");
      const user = req.session && req.session.user;
      if (!user) {
        throw new HttpError(401, "not logged in");
      }
      const result = await sessionService.cancel(id, user);
      res.status(200).json(result);
    }),
  };
}

// -------- Transactions --------
export function transactionController({ transactionService }) {
  return {
    create: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user) {
        throw new HttpError(401, "not logged in");
      }
      const result = await transactionService.create(
        {
          sessionId: req.body?.sessionId,
          method: req.body?.method,
          received: req.body?.received,
        },
        user
      );
      res.status(200).json(result);
    }),

    /** POST /api/cashier/sessions/{id}/paymongo */
    paymongoCheckout: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user) {
        throw new HttpError(401, "not logged in");
      }
      const { id } = req.params || {};
      const result = await transactionService.startPaymongo(
        { sessionId: id },
        user
      );
      res.status(200).json(result);
    }),

    /** GET /api/cashier/paymongo/checkouts/{id} */
    paymongoStatus: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user) {
        throw new HttpError(401, "not logged in");
      }
      const result = await transactionService.paymongoStatus(req.params?.id);
      res.status(200).json(result);
    }),

    /** POST /api/cashier/sessions/{id}/paymongo/cancel */
    paymongoCancel: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user) {
        throw new HttpError(401, "not logged in");
      }
      const result = await transactionService.cancelPaymongo(
        req.params?.id,
        user
      );
      res.status(200).json(result);
    }),

    /** POST /api/paymongo/webhook — public; the signature is the auth. */
    paymongoWebhook: asyncHandler(async (req, res) => {
      const raw = req.rawBody ? req.rawBody.toString("utf8") : "";
      const signature =
        req.get("paymongo-signature") ||
        req.get("x-paymongo-signature") ||
        req.get("paymongo_signature") ||
        "";
      const result = await transactionService.handlePaymongoWebhook(
        raw,
        signature,
        req.body
      );
      res.status(200).json(result);
    }),

    list: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user) {
        throw new HttpError(401, "not logged in");
      }
      const result = await transactionService.list({
        from: req.query.from,
        to: req.query.to,
        month: req.query.month,
        method: req.query.method,
      });
      res.status(200).json(result);
    }),

    get: asyncHandler(async (req, res) => {
      const { ref } = req.params || {};
      if (!ref) throw new HttpError(422, "ref is required");
      const user = req.session && req.session.user;
      if (!user) {
        throw new HttpError(401, "not logged in");
      }
      const result = await transactionService.get(ref);
      res.status(200).json(result);
    }),
  };
}

// -------- Reports --------
export function reportController({ reportService }) {
  return {
    daily: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const result = await reportService.daily({ date: req.query.date });
      res.status(200).json(result);
    }),

    monthly: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const result = await reportService.monthly({ month: req.query.month });
      res.status(200).json(result);
    }),

    income: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const result = await reportService.income({
        from: req.query.from,
        to: req.query.to,
      });
      res.status(200).json(result);
    }),

    export: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const result = await reportService.export({
        from: req.query.from,
        to: req.query.to,
        month: req.query.month,
        method: req.query.method,
      });
      res.set(result.headers);
      res.status(200).type("text/csv; charset=utf-8").send(result.body);
    }),
  };
}

// -------- Health --------
export function healthController({ healthService }) {
  return {
    get: asyncHandler(async (req, res) => {
      const data = await healthService.check();
      res.status(200).json(healthView(data));
    }),
  };
}

// -------- Settings --------
export function settingsController({ settingsService }) {
  return {
    publicConfig: asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store");
      const data = await settingsService.publicConfig();
      res.status(200).json(publicConfigView(data));
    }),
    adminIntegrations: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const data = await settingsService.adminIntegrations();
      res.status(200).json(adminIntegrationsView(data));
    }),
    settingsUpdate: asyncHandler(async (req, res) => {
      const { key } = req.params || {};
      if (!key) throw new HttpError(422, "unknown integration");
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const shaped = await settingsService.update(key, req.body || {}, {
        id: user.id,
        email: user.email ?? null,
        role: user.role,
      });
      res.status(200).json({ ok: true, integration: shaped });
    }),
    /** Super admin: activation state only (credentials are omitted). */
    superAdminIntegrations: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user || user.role !== "super_admin") {
        throw new HttpError(403, "super admin only");
      }
      const data = await settingsService.superAdminIntegrations();
      res.status(200).json(adminIntegrationsView(data));
    }),
    /** Super admin: flip one integration; any other field is rejected. */
    superAdminUpdate: asyncHandler(async (req, res) => {
      const { key } = req.params || {};
      if (!key) throw new HttpError(422, "unknown integration");
      const user = req.session && req.session.user;
      if (!user || user.role !== "super_admin") {
        throw new HttpError(403, "super admin only");
      }
      const shaped = await settingsService.update(key, req.body || {}, {
        id: user.id,
        email: user.email ?? null,
        role: user.role,
      });
      res.status(200).json({ ok: true, integration: shaped });
    }),
  };
}

// -------- Auth --------
export function authController({ authService }) {
  return {
    login: asyncHandler(async (req, res) => {
      const { email, username, password, recaptchaToken } = req.body || {};
      const identifier = email || username || "";
      const result = await authService.login(
        { identifier, password, recaptchaToken },
        req
      );
      res.status(200).json(loginView(result));
    }),

    logout: asyncHandler(async (req, res) => {
      await authService.logout(req);
      res.clearCookie("gh_session", { path: "/" });
      res.status(200).json({ ok: true });
    }),

    me: asyncHandler(async (req, res) => {
      const userId = req.session && req.session.user ? req.session.user.id : null;
      if (!userId) {
        throw new HttpError(401, "not logged in");
      }
      const result = await authService.me(userId, req);
      res.status(200).json(meView(result));
    }),

    google: asyncHandler(async (req, res) => {
      const { idToken, email } = req.body || {};
      const result = await authService.google({ idToken, email }, req);
      res.status(200).json(loginView(result));
    }),

    register: asyncHandler(async (req, res) => {
      const {
        token, firstName, lastName, email, password, username, idToken, recaptchaToken,
      } = req.body || {};

      if (idToken) {
        throw new HttpError(422, "cashier signup takes name, username, email and password only");
      }

      const result = await authService.register({
        token, firstName, lastName, email, password, username, recaptchaToken,
        remoteIp: req.ip,
      });
      res.status(200).json(loginView(result));
    }),
  };
}

// -------- Invitation (public check + admin create/list/revoke) --------
export function invitationController({ invitationService }) {
  return {
    check: asyncHandler(async (req, res) => {
      const { token } = req.params || {};
      if (!token) {
        throw new HttpError(422, "invalid id");
      }
      const result = await invitationService.check(token);
      res.status(200).json(invitationCheckView(result));
    }),

    create: asyncHandler(async (req, res) => {
      const { email } = req.body || {};
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const result = await invitationService.create({
        email,
        actorId: user.id,
        frontendUrl: process.env.FRONTEND_URL,
        mailerDryRun: process.env.MAIL_DRY_RUN === "1",
      });
      res.status(200).json(result);
    }),

    list: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const result = await invitationService.list();
      res.status(200).json(result);
    }),

    revoke: asyncHandler(async (req, res) => {
      const { id } = req.params || {};
      if (!id) throw new HttpError(422, "invalid id");
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const result = await invitationService.revoke(id);
      res.status(200).json(result);
    }),
  };
}

// -------- Cashier (admin only) --------
export function cashierController({ cashierService }) {
  return {
    list: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const result = await cashierService.list({
        status: req.query.status,
        role: req.query.role,
      });
      res.status(200).json(result);
    }),

    update: asyncHandler(async (req, res) => {
      const { id } = req.params || {};
      if (!id) throw new HttpError(422, "invalid id");
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const result = await cashierService.update(id, req.body || {});
      res.status(200).json(result);
    }),

    archive: asyncHandler(async (req, res) => {
      const { id } = req.params || {};
      if (!id) throw new HttpError(422, "invalid id");
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const result = await cashierService.archive(id, user.id);
      res.status(200).json(result);
    }),

    unarchive: asyncHandler(async (req, res) => {
      const { id } = req.params || {};
      if (!id) throw new HttpError(422, "invalid id");
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const result = await cashierService.unarchive(id, user.id);
      res.status(200).json(result);
    }),
  };
}

// -------- Activity log (admin only, AD-026) --------
export function activityController({ activityService }) {
  return {
    list: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const result = await activityService.list({
        action: req.query.action,
        actorId: req.query.actorId,
        from: req.query.from,
        to: req.query.to,
        limit: req.query.limit,
      });
      res.status(200).json(activityView(result));
    }),
  };
}

// -------- F&B products (Sprint 5) --------
export function productController({ productService }) {
  return {
    adminList: asyncHandler(async (req, res) => {
      const result = await productService.list({
        status: req.query.status,
        category: req.query.category,
        q: req.query.q,
      });
      res.status(200).json(result);
    }),

    cashierList: asyncHandler(async (req, res) => {
      const result = await productService.cashierList({
        category: req.query.category,
        q: req.query.q,
      });
      res.status(200).json(result);
    }),

    create: asyncHandler(async (req, res) => {
      const result = await productService.add(
        req.body || {},
        req.session && req.session.user
      );
      res.status(201).json(result);
    }),

    update: asyncHandler(async (req, res) => {
      const { id } = req.params || {};
      if (!id) throw new HttpError(422, "invalid id");
      const result = await productService.update(
        id,
        req.body || {},
        req.session && req.session.user
      );
      res.status(200).json(result);
    }),

    archive: asyncHandler(async (req, res) => {
      const { id } = req.params || {};
      if (!id) throw new HttpError(422, "invalid id");
      const result = await productService.archive(
        id,
        req.session && req.session.user
      );
      res.status(200).json(result);
    }),

    unarchive: asyncHandler(async (req, res) => {
      const { id } = req.params || {};
      if (!id) throw new HttpError(422, "invalid id");
      const result = await productService.unarchive(
        id,
        req.session && req.session.user
      );
      res.status(200).json(result);
    }),
  };
}

// -------- F&B order lines (Sprint 5) --------
export function orderController({ orderService }) {
  return {
    bill: asyncHandler(async (req, res) => {
      const { id } = req.params || {};
      if (!id) throw new HttpError(422, "invalid id");
      const result = await orderService.bill(id);
      res.status(200).json(result);
    }),

    add: asyncHandler(async (req, res) => {
      const { id } = req.params || {};
      if (!id) throw new HttpError(422, "invalid id");
      const result = await orderService.add(
        id,
        {
          productId: req.body?.productId,
          qty: req.body?.qty,
        },
        req.session && req.session.user
      );
      res.status(200).json(result);
    }),

    update: asyncHandler(async (req, res) => {
      const { id, lineId } = req.params || {};
      if (!id) throw new HttpError(422, "invalid id");
      const result = await orderService.update(
        id,
        lineId,
        { qty: req.body?.qty },
        req.session && req.session.user
      );
      res.status(200).json(result);
    }),

    remove: asyncHandler(async (req, res) => {
      const { id, lineId } = req.params || {};
      if (!id) throw new HttpError(422, "invalid id");
      const result = await orderService.remove(
        id,
        lineId,
        req.session && req.session.user
      );
      res.status(200).json(result);
    }),
  };
}

// -------- Reservations (public, guest) --------
export function reservationController({ reservationService }) {
  return {
    create: asyncHandler(async (req, res) => {
      const result = await reservationService.createReservation(
        req.body || {},
        req.ip
      );
      res.status(200).json(result);
    }),

    get: asyncHandler(async (req, res) => {
      const { ref } = req.params || {};
      const contact = req.query?.contact || req.body?.contactNumber;
      const result = await reservationService.getByRef(ref, contact);
      res.status(200).json(result);
    }),

    list: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user) {
        throw new HttpError(401, "not logged in");
      }
      const result = await reservationService.listAll();
      res.status(200).json(result);
    }),

    cancel: asyncHandler(async (req, res) => {
      const { ref } = req.params || {};
      const contact = req.query?.contact || req.body?.contactNumber;
      const result = await reservationService.cancel(ref, contact);
      res.status(200).json(result);
    }),

    accept: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user) {
        throw new HttpError(401, "not logged in");
      }
      const { ref } = req.params || {};
      const result = await reservationService.accept(ref, user.id);
      res.status(200).json(result);
    }),

    reject: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user) {
        throw new HttpError(401, "not logged in");
      }
      const { ref } = req.params || {};
      const result = await reservationService.reject(ref, user.id);
      res.status(200).json(result);
    }),

    getByRef: asyncHandler(async (req, res) => {
      const { ref } = req.params || {};
      const contact = req.query?.contact || req.body?.contactNumber;
      const result = await reservationService.getByRef(ref, contact);
      res.status(200).json(result);
    }),
  };
}
