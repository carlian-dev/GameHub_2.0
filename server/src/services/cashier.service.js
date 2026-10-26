// Cashier service — admin staff management.
// migration.md §13.1 / admin cashiers: archive/unarchive only, admins protected,
// activityLogs on archive/unarchive.
export function cashierService({ cashierModel, db }) {
  const activityLogs = db.collection("activityLogs");

  const shape = (doc) => ({
    id: String(doc._id),
    email: doc.email ?? null,
    username: doc.username ?? null,
    role: doc.role ?? "cashier",
    authProvider: doc.authProvider ?? "password",
    status: doc.status ?? "",
    firstName: doc.firstName ?? "",
    lastName: doc.lastName ?? "",
    displayName: doc.displayName ?? "",
    emailVerified: !!doc.emailVerified,
    schedule: doc.schedule ?? "",
    createdAt:
      doc.createdAt instanceof Date ? doc.createdAt.toISOString() : null,
  });

  return {
    async list({ status = "all", role = "all" } = {}) {
      const filter = {};
      if (role === "cashier" || role === "admin") filter.role = role;
      if (
        status === "pending" ||
        status === "active" ||
        status === "archived" ||
        status === "declined"
      ) {
        filter.status = status;
      }
      const docs = await cashierModel.list(filter);
      return { ok: true, cashiers: docs.map(shape) };
    },

    async update(id, { displayName, schedule }) {
      const set = {};
      if (displayName !== undefined) {
        set.displayName = String(displayName).trim();
      }
      if (schedule !== undefined) {
        const trimmed = String(schedule).trim();
        if (trimmed !== "" && !/^([01]\d|2[0-3]):[0-5]\d - ([01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) {
          const err = new Error("schedule must be HH:MM - HH:MM (or empty to clear)");
          err.status = 422;
          throw err;
        }
        set.schedule = trimmed;
      }
      if (Object.keys(set).length === 0) {
        const err = new Error("nothing to update (allowed: displayName, schedule)");
        err.status = 422;
        throw err;
      }

      const user = await cashierModel.findById(id);
      if (!user || user.role !== "cashier") {
        const err = new Error("cashier not found");
        err.status = 404;
        throw err;
      }

      await cashierModel.update(id, set);
      const fresh = await cashierModel.findById(id);
      return { ok: true, cashier: shape(fresh) };
    },

    async archive(id, actorId) {
      const user = await cashierModel.findById(id);
      if (!user) {
        const err = new Error("account not found");
        err.status = 404;
        throw err;
      }
      if (user.role === "admin") {
        const err = new Error("admin accounts cannot be archived");
        err.status = 403;
        throw err;
      }
      if (user.role !== "cashier") {
        const err = new Error("cashier not found");
        err.status = 404;
        throw err;
      }

      await cashierModel.setStatus(id, "archived");
      await activityLogs.insertOne({
        actorId,
        action: "archive_cashier",
        target: String(user._id),
        at: new Date(),
      });
      return { ok: true, id: String(user._id), status: "archived" };
    },

    async unarchive(id, actorId) {
      const user = await cashierModel.findById(id);
      if (!user) {
        const err = new Error("account not found");
        err.status = 404;
        throw err;
      }
      if (user.role === "admin") {
        const err = new Error("admin accounts cannot be archived");
        err.status = 403;
        throw err;
      }
      if (user.role !== "cashier") {
        const err = new Error("cashier not found");
        err.status = 404;
        throw err;
      }
      if (user.status !== "archived") {
        const err = new Error("only archived accounts can be unarchived");
        err.status = 422;
        throw err;
      }

      await cashierModel.setStatus(id, "active");
      await activityLogs.insertOne({
        actorId,
        action: "unarchive_cashier",
        target: String(user._id),
        at: new Date(),
      });
      return { ok: true, id: String(user._id), status: "active" };
    },
  };
}
