// Table service — business rules for table CRUD/lifecycle.
// migration.md §13.3: statuses available|occupied|reserved|maintenance;
// admin list filters: archived → archived only; valid status → that status +
// not archived; anything else → all.
const TABLE_STATUSES = ["available", "occupied", "reserved", "maintenance"];

export function tableService({ tableModel, db }) {
  const activityLogs = db.collection("activityLogs");

  const shape = (doc) => ({
    id: String(doc._id),
    name: doc.name ?? "",
    status: doc.status ?? "available",
    archived: !!doc.archived,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : null,
  });

  return {
    async list({ status = "all" } = {}) {
      const filter = {};
      if (status === "archived") {
        filter.archived = true;
      } else if (TABLE_STATUSES.includes(status)) {
        filter.status = status;
        filter.archived = { $ne: true };
      }
      const docs = await tableModel.list(filter);
      return { ok: true, tables: docs.map(shape) };
    },

    async add(name) {
      const trimmed = String(name).trim();
      if (trimmed === "" || trimmed.length > 60) {
        const err = new Error("table name is required (max 60 chars)");
        err.status = 422;
        throw err;
      }
      if (await tableModel.findByName(trimmed)) {
        const err = new Error("table name already used");
        err.status = 409;
        throw err;
      }
      const now = new Date();
      const id = await tableModel.create({
        name: trimmed,
        status: "available",
        archived: false,
        createdAt: now,
      });
      const doc = await tableModel.findById(id);
      return { ok: true, table: shape(doc) };
    },

    async rename(id, name) {
      const trimmed = String(name).trim();
      if (trimmed === "" || trimmed.length > 60) {
        const err = new Error("table name is required (max 60 chars)");
        err.status = 422;
        throw err;
      }
      const doc = await tableModel.findById(id);
      if (!doc) {
        const err = new Error("table not found");
        err.status = 404;
        throw err;
      }
      const dup = await tableModel.findByName(trimmed);
      if (dup && String(dup._id) !== String(doc._id)) {
        const err = new Error("table name already used");
        err.status = 409;
        throw err;
      }
      await tableModel.update(id, { name: trimmed });
      const fresh = await tableModel.findById(id);
      return { ok: true, table: shape(fresh) };
    },

    async status(id, status) {
      const s = String(status).toLowerCase().trim();
      if (!TABLE_STATUSES.includes(s)) {
        const err = new Error(
          "status must be available, occupied, reserved, or maintenance"
        );
        err.status = 422;
        throw err;
      }
      const doc = await tableModel.findById(id);
      if (!doc) {
        const err = new Error("table not found");
        err.status = 404;
        throw err;
      }
      if (doc.archived) {
        const err = new Error(
          "archived tables cannot change status — unarchive first"
        );
        err.status = 422;
        throw err;
      }
      await tableModel.update(id, { status: s });
      const fresh = await tableModel.findById(id);
      return { ok: true, table: shape(fresh) };
    },

    async archive(id) {
      const doc = await tableModel.findById(id);
      if (!doc) {
        const err = new Error("table not found");
        err.status = 404;
        throw err;
      }
      await tableModel.update(id, { archived: true });
      return { ok: true, id: String(doc._id), archived: true };
    },

    async unarchive(id) {
      const doc = await tableModel.findById(id);
      if (!doc) {
        const err = new Error("table not found");
        err.status = 404;
        throw err;
      }
      if (!doc.archived) {
        const err = new Error("only archived tables can be unarchived");
        err.status = 422;
        throw err;
      }
      await tableModel.update(id, { archived: false, status: "available" });
      const fresh = await tableModel.findById(id);
      return { ok: true, table: shape(fresh) };
    },

    async publicList() {
      const docs = await tableModel.list({
        status: "available",
        archived: { $ne: true },
      });
      return {
        ok: true,
        tables: docs.map((d) => ({
          id: String(d._id),
          name: d.name ?? "",
          status: d.status ?? "available",
        })),
      };
    },

    /** Cashier read-only table list — excludes archived. */
    async cashierList({ status = "all" } = {}) {
      const filter = { archived: { $ne: true } };
      if (TABLE_STATUSES.includes(status)) {
        filter.status = status;
      }
      const docs = await tableModel.list(filter);
      return {
        ok: true,
        tables: docs.map((d) => ({
          id: String(d._id),
          name: d.name ?? "",
          status: d.status ?? "available",
        })),
      };
    },
  };
}
