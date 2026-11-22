// Reservation model: named Mongo queries for reservations collection,
// with pessimistic locking for concurrency control.
import { toObjectId } from "./bson.js";
import { createReservationLockManager } from "../utils/reservationLock.js";

export function reservationModel({ db }) {
  const coll = db.collection("reservations");
  const lockManager = createReservationLockManager({ db });

  return {
    // Locking operations (pessimistic concurrency control for reservations)
    acquireLock: lockManager.acquireLock,
    releaseLock: lockManager.releaseLock,
    withLock: lockManager.withLock,
    isLocked: lockManager.isLocked,
    withTableLock: lockManager.withTableLock,
    withReservationLock: lockManager.withReservationLock,

    async list(filter = {}) {
      return await coll.find(filter, { sort: { startTime: 1 } }).toArray();
    },
    async findById(id) {
      const oid = toObjectId(id);
      if (!oid) return null;
      return await coll.findOne({ _id: oid });
    },
    async findByRef(ref) {
      return await coll.findOne({ ref });
    },
    async findOverlapping(tableId, start, end, excludeId = null) {
      const filter = {
        tableId: toObjectId(tableId) || tableId,
        status: { $in: ["reserved", "accepted", "checked-in"] },
        startTime: { $lt: end },
        endTime: { $gt: start },
      };
      if (excludeId) {
        const oid = toObjectId(excludeId);
        if (oid) filter._id = { $ne: oid };
      }
      return await coll.find(filter).toArray();
    },
    async create(doc) {
      // Retain MVCC version: 1
      const res = await coll.insertOne({ version: 1, ...doc });
      return res.insertedId;
    },
    async update(id, set) {
      const oid = toObjectId(id);
      if (!oid) return null;
      // Retain MVCC $inc: { version: 1 }
      return await coll.updateOne(
        { _id: oid },
        { $set: set, $inc: { version: 1 } }
      );
    },
    /**
     * Conditional transition (e.g. accepted -> checked-in). Returns true only
     * for the request that actually moved the document, so two cashiers
     * clicking "Start session" can never open two sessions.
     */
    async claim(id, fromStatus, set) {
      const oid = toObjectId(id);
      if (!oid) return false;
      const res = await coll.updateOne(
        { _id: oid, status: fromStatus },
        { $set: set, $inc: { version: 1 } }
      );
      return res.modifiedCount === 1;
    },
  };
}
