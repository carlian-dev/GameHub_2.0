// Rate service — business rules for hourly table rates.
// migration.md §13.3: regular / special; positive numeric; upsert; active: true;
// update updatedAt. Seeded defaults (regular 140, special 180) only in scripts.
const RATE_TYPES = ["regular", "special"];

export function rateService({ rateModel }) {
  const shape = (doc) => ({
    type: doc.type ?? "",
    pricePerHour: doc.pricePerHour ?? 0,
    active: doc.active ?? true,
  });

  return {
    async list() {
      const docs = await rateModel.list();
      return { ok: true, rates: docs.map(shape) };
    },

    async set({ type, pricePerHour }) {
      const t = String(type).toLowerCase().trim();
      if (!RATE_TYPES.includes(t)) {
        const err = new Error("type must be regular or special");
        err.status = 422;
        throw err;
      }
      const price = Number(pricePerHour);
      if (!Number.isFinite(price) || price <= 0) {
        const err = new Error("pricePerHour must be a positive number");
        err.status = 422;
        throw err;
      }
      await rateModel.upsert(t, {
        pricePerHour: price,
        active: true,
        updatedAt: new Date(),
      });
      const doc = await rateModel.findByType(t);
      return { ok: true, rate: shape(doc) };
    },
  };
}
