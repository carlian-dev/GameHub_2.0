// Pessimistic locking mechanism for the reservation section.
//
// Concurrency control via locking:
// Ensures critical reservation operations (e.g., table slot booking, reservation state transitions,
// cashier check-in) execute with mutual exclusion.
//
// Stored in the MongoDB collection (`reservationLocks`) with atomic lease acquisition (TTL)
// and unique owner tokens. Also maintains an in-process serialized queue per resource key to
// cleanly serialize concurrent requests within the same process without busy-spinning the database.

import crypto from "node:crypto";
import { HttpError } from "./HttpError.js";

/**
 * In-process FIFO mutex per resource key.
 * Serializes concurrent requests within a single process.
 */
export class KeyedMutex {
  constructor() {
    this.queues = new Map();
  }

  async acquire(key, timeoutMs = 5000) {
    let release;
    let timer;
    const ticket = new Promise((resolve) => {
      release = resolve;
    });

    const prev = this.queues.get(key) || Promise.resolve();
    let timedOut = false;

    const waiter = new Promise((resolve, reject) => {
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          reject(
            new HttpError(
              409,
              `reservation lock conflict: timed out waiting for lock on "${key}"`
            )
          );
        }, timeoutMs);
      }
      prev.then(() => {
        if (timer) clearTimeout(timer);
        if (!timedOut) {
          resolve();
        }
      });
    });

    this.queues.set(key, prev.then(() => ticket).catch(() => {}));

    try {
      await waiter;
    } catch (err) {
      release();
      throw err;
    }

    return () => {
      release();
      if (this.queues.get(key) === prev.then(() => ticket).catch(() => {})) {
        this.queues.delete(key);
      }
    };
  }

  isLocked(key) {
    return this.queues.has(key);
  }
}

/**
 * Creates a reservation lock manager.
 * Supports both MongoDB database-level locking and in-process synchronization.
 */
export function createReservationLockManager({ db } = {}) {
  const inProcessMutex = new KeyedMutex();
  const locksColl =
    db && typeof db.collection === "function" ? db.collection("reservationLocks") : null;

  /**
   * Acquire a pessimistic lock on a resource.
   */
  async function acquireLock(resource, options = {}) {
    const {
      ttlMs = 10000,
      timeoutMs = 5000,
      retryIntervalMs = 50,
      owner = crypto.randomUUID(),
    } = options;

    const resourceKey = String(resource || "").trim();
    if (!resourceKey) {
      throw new Error("resource key is required for reservation locking");
    }

    const releaseInProcess = await inProcessMutex.acquire(resourceKey, timeoutMs);

    const hasMongoColl =
      locksColl &&
      typeof locksColl.insertOne === "function" &&
      typeof locksColl.findOneAndUpdate === "function";

    if (!hasMongoColl) {
      return {
        resource: resourceKey,
        owner,
        releaseInProcess,
      };
    }

    const start = Date.now();
    let acquired = false;

    while (!acquired) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlMs);

      try {
        await locksColl.insertOne({
          _id: resourceKey,
          resource: resourceKey,
          owner,
          acquiredAt: now,
          expiresAt,
        });
        acquired = true;
        break;
      } catch (err) {
        if (err && err.code === 11000) {
          // Document already exists — check if previous lock expired
          try {
            const stolen = await locksColl.findOneAndUpdate(
              { _id: resourceKey, expiresAt: { $lt: now } },
              { $set: { owner, acquiredAt: now, expiresAt } },
              { returnDocument: "after" }
            );
            if (stolen && (stolen._id || stolen.value || stolen.owner)) {
              acquired = true;
              break;
            }
          } catch (_) {
            // Retry on query race
          }
        } else {
          releaseInProcess();
          throw err;
        }
      }

      const elapsed = Date.now() - start;
      if (elapsed >= timeoutMs) {
        releaseInProcess();
        throw new HttpError(
          409,
          `reservation lock conflict: resource "${resourceKey}" is currently locked, please try again`
        );
      }

      const waitTime = Math.min(retryIntervalMs, timeoutMs - elapsed);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    return {
      resource: resourceKey,
      owner,
      releaseInProcess,
    };
  }

  /**
   * Release an acquired pessimistic lock.
   */
  async function releaseLock(lockOrResource, maybeOwner) {
    let resource;
    let owner;
    let releaseInProcess;

    if (typeof lockOrResource === "object" && lockOrResource !== null) {
      resource = lockOrResource.resource;
      owner = lockOrResource.owner;
      releaseInProcess = lockOrResource.releaseInProcess;
    } else {
      resource = String(lockOrResource || "").trim();
      owner = maybeOwner;
    }

    try {
      const hasMongoColl =
        locksColl && typeof locksColl.deleteOne === "function";
      if (hasMongoColl && resource && owner) {
        await locksColl.deleteOne({ _id: resource, owner });
      }
    } finally {
      if (typeof releaseInProcess === "function") {
        releaseInProcess();
      }
    }
  }

  /**
   * Execute `fn` under a pessimistic lock on `resource`.
   */
  async function withLock(resource, fn, options = {}) {
    const lock = await acquireLock(resource, options);
    try {
      return await fn();
    } finally {
      await releaseLock(lock);
    }
  }

  /**
   * Check if a resource is currently locked.
   */
  async function isLocked(resource) {
    const resourceKey = String(resource || "").trim();
    if (inProcessMutex.isLocked(resourceKey)) return true;
    if (locksColl && typeof locksColl.findOne === "function") {
      const doc = await locksColl.findOne({ _id: resourceKey });
      if (doc && doc.expiresAt && doc.expiresAt > new Date()) return true;
    }
    return false;
  }

  return {
    acquireLock,
    releaseLock,
    withLock,
    isLocked,
    withTableLock(tableId, fn, options) {
      return withLock(`table:${tableId}`, fn, options);
    },
    withReservationLock(ref, fn, options) {
      return withLock(`reservation:${ref}`, fn, options);
    },
  };
}
