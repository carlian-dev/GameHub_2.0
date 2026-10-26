// Health model: ping Atlas + count healthcheck documents.
// migration.md §13.1 shared health behavior.
export function healthModel({ db }) {
  return {
    async ping() {
      await db.command({ ping: 1 });
      return "ok";
    },
    async countHealthcheck() {
      return await db.collection("healthcheck").countDocuments();
    },
  };
}
