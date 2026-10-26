// Table model: named Mongo queries for tables collection.
// migration.md §13.3, §13.8 — never return a raw Mongo document.
import { toObjectId } from "./bson.js";

export function tableModel({ db }) {
  const coll = db.collection("tables");

  return {
    async list(filter = {}) {
      return await coll.find(filter, { sort: { name: 1 } }).toArray();
    },
    async findById(id) {
      const oid = toObjectId(id);
      if (!oid) return null;
      return await coll.findOne({ _id: oid });
    },
    async findByName(name) {
      return await coll.findOne({ name });
    },
    async create(doc) {
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
