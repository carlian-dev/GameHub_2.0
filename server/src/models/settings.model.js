// Settings model: read settings documents (DB authoritative).
// migration.md §13.6
export function settingsModel({ db }) {
  const coll = db.collection("settings");

  return {
    async findMany(keys) {
      if (!keys || keys.length === 0) return {};
      const docs = await coll.find({ key: { $in: keys } }).toArray();
      const out = {};
      for (const doc of docs) {
        out[doc.key] = doc;
      }
      return out;
    },
    async findOne(key) {
      return await coll.findOne({ key });
    },
  };
}
