// Product service — admin F&B catalogue (Sprint 5, AD-031/032/033).
// Products are never deleted: archive/unarchive only. Price is the current
// sellable price; order lines keep their own snapshot (see order.service).
import { ObjectId } from "mongodb";
import { round2 } from "../utils/numbers.js";

export const PRODUCT_CATEGORIES = ["food", "beverage", "other"];
const MAX_PRICE = 100000;
const MAX_NAME = 80;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function actorIdOf(actor) {
  return actor && actor.id ? String(actor.id) : "system";
}

function shape(doc) {
  return {
    id: doc._id != null ? String(doc._id) : null,
    name: doc.name ?? "",
    category: doc.category ?? "other",
    price: round2(Number(doc.price ?? 0)),
    archived: !!doc.archived,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : null,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : null,
    archivedAt: doc.archivedAt instanceof Date ? doc.archivedAt.toISOString() : null,
  };
}

function parseName(raw) {
  if (typeof raw !== "string") {
    throw httpError(422, "name is required (1-80 characters)");
  }
  const name = raw.trim();
  if (name.length < 1 || name.length > MAX_NAME) {
    throw httpError(422, "name is required (1-80 characters)");
  }
  return name;
}

function parseCategory(raw) {
  const category = String(raw ?? "").trim().toLowerCase();
  if (!PRODUCT_CATEGORIES.includes(category)) {
    throw httpError(422, "category must be food, beverage, or other");
  }
  return category;
}

function parsePrice(raw) {
  if (typeof raw !== "number" && typeof raw !== "string") {
    throw httpError(422, "price must be a number greater than 0");
  }
  const text = typeof raw === "string" ? raw.trim() : raw;
  if (text === "") {
    throw httpError(422, "price is required");
  }
  const price = Number(text);
  if (!Number.isFinite(price)) {
    throw httpError(422, "price must be a number greater than 0");
  }
  if (!(price > 0) || price > MAX_PRICE) {
    throw httpError(422, `price must be greater than 0 and at most ${MAX_PRICE}`);
  }
  if (Math.abs(round2(price) - price) > 1e-9) {
    throw httpError(422, "price can have at most 2 decimal places");
  }
  return round2(price);
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameFilter(q) {
  const term = String(q ?? "").trim();
  if (!term) return null;
  return { $regex: escapeRegex(term), $options: "i" };
}

export function productService({ productModel, db }) {
  const activityLogs = db.collection("activityLogs");

  async function log(action, target, context) {
    await activityLogs.insertOne({
      actorId: context.actorId,
      action,
      target: String(target),
      ...context.fields,
      at: new Date(),
    });
  }

  return {
    /** GET /api/admin/products — active|archived|all + category + q. */
    async list({ status = "active", category, q } = {}) {
      const filter = {};
      if (status === "archived") filter.archived = true;
      else if (status === "all") {
        // no archived filter
      } else filter.archived = { $ne: true }; // default/active
      if (PRODUCT_CATEGORIES.includes(String(category ?? "").toLowerCase())) {
        filter.category = String(category).toLowerCase();
      }
      const regex = nameFilter(q);
      if (regex) filter.name = regex;
      const docs = await productModel.list(filter);
      return { ok: true, products: docs.map(shape) };
    },

    /** GET /api/cashier/products — active products only. */
    async cashierList({ category, q } = {}) {
      const filter = { archived: { $ne: true } };
      if (PRODUCT_CATEGORIES.includes(String(category ?? "").toLowerCase())) {
        filter.category = String(category).toLowerCase();
      }
      const regex = nameFilter(q);
      if (regex) filter.name = regex;
      const docs = await productModel.list(filter, { sort: { category: 1, name: 1 } });
      return { ok: true, products: docs.map(shape) };
    },

    /** POST /api/admin/products */
    async add({ name, category, price }, actor) {
      const cleanName = parseName(name);
      const cleanCategory = parseCategory(category);
      const cleanPrice = parsePrice(price);
      const nameKey = cleanName.toLowerCase();
      if (await productModel.findByNameKey(nameKey)) {
        throw httpError(409, "product name already used");
      }
      const now = new Date();
      let id;
      try {
        id = await productModel.insert({
          name: cleanName,
          nameKey,
          category: cleanCategory,
          price: cleanPrice,
          archived: false,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        });
      } catch (e) {
        if (e && e.code === 11000) {
          throw httpError(409, "product name already used");
        }
        throw e;
      }
      await log("fnb_product_add", id, {
        actorId: actorIdOf(actor),
        fields: {
          productName: cleanName,
          category: cleanCategory,
          price: cleanPrice,
        },
      });
      const doc = await productModel.findById(id);
      return { ok: true, product: shape(doc) };
    },

    /** PUT /api/admin/products/{id} */
    async update(id, fields = {}, actor) {
      if (!/^[0-9a-fA-F]{24}$/.test(String(id))) {
        throw httpError(404, "product not found");
      }
      const oid = new ObjectId(id);
      const doc = await productModel.findById(oid);
      if (!doc) throw httpError(404, "product not found");

      const set = { updatedAt: new Date() };
      const changed = [];
      const oldPrice = round2(Number(doc.price ?? 0));
      let newPrice = oldPrice;

      if (fields.name !== undefined) {
        const name = parseName(fields.name);
        if (name !== doc.name) {
          const nameKey = name.toLowerCase();
          const dup = await productModel.findOne({
            nameKey,
            _id: { $ne: oid },
          });
          if (dup) throw httpError(409, "product name already used");
          set.name = name;
          set.nameKey = nameKey;
          changed.push("name");
        }
      }
      if (fields.category !== undefined) {
        const category = parseCategory(fields.category);
        if (category !== doc.category) {
          set.category = category;
          changed.push("category");
        }
      }
      if (fields.price !== undefined) {
        const price = parsePrice(fields.price);
        if (price !== oldPrice) {
          set.price = price;
          newPrice = price;
          changed.push("price");
        }
      }

      if (changed.length === 0) {
        throw httpError(422, "nothing to update");
      }

      await productModel.update(oid, set);
      const context = {
        actorId: actorIdOf(actor),
        fields: {
          productName: set.name ?? doc.name,
          changedFields: changed,
        },
      };
      if (changed.includes("price")) {
        context.fields.oldPrice = oldPrice;
        context.fields.newPrice = newPrice;
      }
      await log("fnb_product_update", oid, context);
      const fresh = await productModel.findById(oid);
      return { ok: true, product: shape(fresh) };
    },

    /** POST /api/admin/products/{id}/archive — idempotent. */
    async archive(id, actor) {
      if (!/^[0-9a-fA-F]{24}$/.test(String(id))) {
        throw httpError(404, "product not found");
      }
      const oid = new ObjectId(id);
      const doc = await productModel.findById(oid);
      if (!doc) throw httpError(404, "product not found");
      if (doc.archived) return { ok: true, product: shape(doc) };
      const now = new Date();
      await productModel.update(oid, {
        archived: true,
        archivedAt: now,
        updatedAt: now,
      });
      await log("fnb_product_archive", oid, {
        actorId: actorIdOf(actor),
        fields: { productName: doc.name ?? "" },
      });
      const fresh = await productModel.findById(oid);
      return { ok: true, product: shape(fresh) };
    },

    /** POST /api/admin/products/{id}/unarchive */
    async unarchive(id, actor) {
      if (!/^[0-9a-fA-F]{24}$/.test(String(id))) {
        throw httpError(404, "product not found");
      }
      const oid = new ObjectId(id);
      const doc = await productModel.findById(oid);
      if (!doc) throw httpError(404, "product not found");
      if (!doc.archived) {
        throw httpError(422, "only archived products can be unarchived");
      }
      const now = new Date();
      await productModel.update(oid, {
        archived: false,
        archivedAt: null,
        updatedAt: now,
      });
      await log("fnb_product_unarchive", oid, {
        actorId: actorIdOf(actor),
        fields: { productName: doc.name ?? "" },
      });
      const fresh = await productModel.findById(oid);
      return { ok: true, product: shape(fresh) };
    },
  };
}
