// Health service — business rules for GET /api/health.
// migration.md §11 / shared health behavior.
export function healthService({ healthModel, dbName }) {
  return {
    async check() {
      const ping = await healthModel.ping();
      const healthcheckCount = await healthModel.countHealthcheck();
      return { db: dbName, ping, healthcheckCount };
    },
  };
}
