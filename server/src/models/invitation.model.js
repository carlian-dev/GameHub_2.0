// Invitation model: named Mongo queries for invitations collection.
// migration.md §13.2 — store only sha256(token), TTL 24h, single use.
import { toObjectId } from "./bson.js";

export function invitationModel({ db }) {
  const coll = db.collection("invitations");

  return {
    async findByTokenHash(tokenHash) {
      return await coll.findOne({ tokenHash, used: false });
    },
    async findByTokenHashAny(tokenHash) {
      return await coll.findOne({ tokenHash });
    },
    async markUsed(invitationId, usedAt) {
      const oid = toObjectId(invitationId);
      if (!oid) return null;
      return await coll.updateOne(
        { _id: oid, used: false },
        { $set: { used: true, usedAt } }
      );
    },
    async create({ email, tokenHash, expiresAt, createdBy, createdAt }) {
      const res = await coll.insertOne({
        email,
        tokenHash,
        role: "cashier",
        expiresAt,
        used: false,
        createdBy,
        createdAt,
      });
      return res.insertedId;
    },
    async list() {
      return await coll.find({}, { sort: { createdAt: -1 } }).toArray();
    },
    async findById(id) {
      const oid = toObjectId(id);
      if (!oid) return null;
      return await coll.findOne({ _id: oid });
    },
    async revoke(id) {
      const oid = toObjectId(id);
      if (!oid) return null;
      return await coll.updateOne(
        { _id: oid },
        { $set: { used: true, revoked: true } }
      );
    },
  };
}
