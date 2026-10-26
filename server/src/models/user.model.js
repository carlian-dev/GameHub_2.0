// User model: named Mongo queries for users collection.
// migration.md §13.1, §13.8 — project out passwordHash in lists, never return raw doc.
import { toObjectId } from "./bson.js";

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
    async findById(id) {
      const oid = toObjectId(id);
      if (!oid) return null;
      return await coll.findOne({ _id: oid });
    },
  };
}
