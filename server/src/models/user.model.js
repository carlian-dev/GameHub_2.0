// User model: named Mongo queries for users collection.
// migration.md §13.1, §13.8 — project out passwordHash in lists, never return raw doc.
import { toObjectId } from "./bson.js";
import { userVersionFilter } from "../utils/concurrency.js";

const WITHOUT_PASSWORD = { projection: { passwordHash: 0 } };

export function userModel({ db }) {
  const coll = db.collection("users");

  return {
    async findByEmail(email) {
      return await coll.findOne({ email: String(email).toLowerCase() });
    },
    async findByUsername(username) {
      return await coll.findOne({
        username: String(username).toLowerCase(),
        role: "cashier",
      });
    },
    async findByResetTokenHash(tokenHash) {
      return await coll.findOne({ "resetPassword.tokenHash": tokenHash });
    },
    async findById(id) {
      const oid = toObjectId(id);
      if (!oid) return null;
      return await coll.findOne({ _id: oid }, WITHOUT_PASSWORD);
    },
    /**
     * Optimistic concurrency: write only if the stored version is still the
     * one the caller read. Returns the raw update result; callers turn
     * `matchedCount === 0` into a 409 (or 401 when the user vanished).
     */
    async updateWithVersion(id, expectedVersion, set) {
      const oid = toObjectId(id);
      if (!oid) return null;
      return await coll.updateOne(
        { _id: oid, ...userVersionFilter(expectedVersion) },
        { $set: { ...set, version: expectedVersion + 1 } }
      );
    },
    /** Bulk lookup for activity-log actor/target names. */
    async findByIds(ids = []) {
      const oids = ids.map(toObjectId).filter(Boolean);
      if (oids.length === 0) return [];
      return await coll.find({ _id: { $in: oids } }, WITHOUT_PASSWORD).toArray();
    },
  };
}
