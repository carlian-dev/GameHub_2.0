// Cashier model: named Mongo queries for users collection.
// migration.md §13.1, §13.8 — project out passwordHash in lists/details.
import { toObjectId } from "./bson.js";
import { userVersionFilter } from "../utils/concurrency.js";

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
    /** Write only when the account is still at the version the admin read. */
    async update(id, version, set) {
      const oid = toObjectId(id);
      if (!oid) return null;
      return await coll.updateOne(
        { _id: oid, ...userVersionFilter(version) },
        { $set: { ...set, version: version + 1 } }
      );
    },
    async setStatus(id, status) {
      const oid = toObjectId(id);
      if (!oid) return null;
      return await coll.updateOne(
        { _id: oid },
        { $set: { status }, $inc: { version: 1 } }
      );
    },
  };
}
