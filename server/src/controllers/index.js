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

    list: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user) {
        throw new HttpError(401, "not logged in");
      }
      const result = await transactionService.list({
        from: req.query.from,
        to: req.query.to,
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

    export: asyncHandler(async (req, res) => {
      const user = req.session && req.session.user;
      if (!user || user.role !== "admin") {
        throw new HttpError(401, "not logged in");
      }
      const result = await reportService.export({
        from: req.query.from,
        to: req.query.to,
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
      const adminEmail = user ? user.email : null;
      const shaped = await settingsService.update(key, req.body || {}, adminEmail);
      res.status(200).json({ ok: true, integration: shaped });
    }),
  };
}

// -------- Auth --------
export function authController({ authService }) {
  return {
    login: asyncHandler(async (req, res) => {
      const { email, username, password } = req.body || {};
      const identifier = email || username || "";
      const result = await authService.login({ identifier, password }, req);
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
      const result = await authService.google({ idToken, email });
      res.status(200).json(loginView(result));
    }),

    register: asyncHandler(async (req, res) => {
      const {
        token, firstName, lastName, email, password, username, idToken,
      } = req.body || {};

      if (idToken) {
        throw new HttpError(422, "cashier signup takes name, username, email and password only");
      }

      const result = await authService.register({
        token, firstName, lastName, email, password, username,
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
