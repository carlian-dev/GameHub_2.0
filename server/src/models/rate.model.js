// Rate model: named Mongo queries for rates collection.
// migration.md §13.3 — rates seeded once, never per request.
import { toObjectId } from "./bson.js";

export function rateModel({ db }) {
  const coll = db.collection("rates");

  return {
    async list() {
      return await coll.find({}).toArray();
    },
    async findByType(type) {
      return await coll.findOne({ type });
    },
    async upsert(type, set) {
      return await coll.updateOne({ type }, { $set: set }, { upsert: true });
    },
  };
}
