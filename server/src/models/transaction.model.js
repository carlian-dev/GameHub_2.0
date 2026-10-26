// Transaction model: named Mongo queries for transactions collection.
// migration.md §13.5 — never return a raw Mongo document.
import { toObjectId } from "./bson.js";

export function transactionModel({ db }) {
  const coll = db.collection("transactions");

  return {
    async findByRef(ref) {
      return await coll.findOne({ ref });
    },
    async findBySessionId(sessionId) {
      const oid = toObjectId(sessionId);
      if (!oid) return null;
      return await coll.findOne({ sessionId: oid });
    },
    async insert(doc) {
      const res = await coll.insertOne(doc);
      return res.insertedId;
    },
    async list(filter = {}, opts = {}) {
      return await coll.find(filter, {
        sort: { paidAt: -1 },
        ...opts,
      }).toArray();
    },
    async findById(id) {
      const oid = toObjectId(id);
      if (!oid) return null;
      return await coll.findOne({ _id: oid });
    },
  };
}
