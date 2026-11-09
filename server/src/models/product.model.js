// Product model: named Mongo queries for the `products` collection (Sprint 5).
// migration.md §13 layout — models own driver calls, never exposed raw.
import { toObjectId } from "./bson.js";

export function productModel({ db }) {
  const coll = db.collection("products");

  return {
    async list(filter = {}, opts = {}) {
      return await coll
        .find(filter, {
          sort: { archived: 1, name: 1 },
          limit: 500,
          ...opts,
        })
        .toArray();
    },
    async findById(id) {
      const oid = toObjectId(id);
      if (!oid) return null;
      return await coll.findOne({ _id: oid });
    },
    async findOne(filter) {
      return await coll.findOne(filter);
    },
    async findByNameKey(nameKey) {
      return await coll.findOne({ nameKey });
    },
    async insert(doc) {
      const res = await coll.insertOne(doc);
      return res.insertedId;
    },
    async update(id, set) {
      const oid = toObjectId(id);
      if (!oid) return null;
      return await coll.updateOne({ _id: oid }, { $set: set });
    },
  };
}
