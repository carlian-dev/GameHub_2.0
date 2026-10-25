// Session model: named Mongo queries for sessions collection.
// migration.md §13.4, §13.8 — never return a raw Mongo document.
import { toObjectId } from "./bson.js";

export function sessionModel({ db }) {
  const coll = db.collection("sessions");

  return {
    async findById(id) {
      const oid = toObjectId(id);
      if (!oid) return null;
      return await coll.findOne({ _id: oid });
    },
    async findActiveByTable(tableId) {
      const oid = toObjectId(tableId);
      if (!oid) return null;
      return await coll.findOne({ tableId: oid, status: "active" });
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
    async list(filter = {}, opts = {}) {
      return await coll.find(filter, {
        sort: { startTime: -1 },
        limit: 200,
        ...opts,
      }).toArray();
    },
  };
}
