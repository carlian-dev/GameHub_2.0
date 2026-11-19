// Activity log model: read access to activityLogs for the admin viewer.
// Writes stay in the services that own each action (architecture.md §6).
export function activityModel({ db }) {
  const coll = db.collection("activityLogs");

  return {
    /** Newest first. `filter` is a plain Mongo query built by the service. */
    async list(filter = {}, { limit = 200, skip = 0 } = {}) {
      return await coll
        .find(filter)
        .sort({ at: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
    },

    async count(filter = {}) {
      return await coll.countDocuments(filter);
    },
  };
}
