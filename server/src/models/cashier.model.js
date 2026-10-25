// Cashier model: named Mongo queries for users collection.
// migration.md §13.1, §13.8 — project out passwordHash in lists/details.
import { toObjectId } from "./bson.js";

const WITHOUT_PASSWORD = { projection: { passwordHash: 0 } };

export function cashierModel({ db }) {
  const coll = db.collection("users");

  return {
    async list(filter = {}) {
      return await coll
        .find(filter, { ...WITHOUT_PASSWORD, sort: { createdAt: -1 } })
        .toArray();
    },
    async findById(id) {
      const oid = toObjectId(id);
      if (!oid) return null;
      return await coll.findOne({ _id: oid }, WITHOUT_PASSWORD);
    },
    async update(id, set) {
      const oid = toObjectId(id);
      if (!oid) return null;
      return await coll.updateOne({ _id: oid }, { $set: set });
    },
    async setStatus(id, status) {
      const oid = toObjectId(id);
      if (!oid) return null;
      return await coll.updateOne({ _id: oid }, { $set: { status } });
    },
  };
}
