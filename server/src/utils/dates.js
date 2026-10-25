// Date helpers — no native Date local-time math for Manila rate window.
// migration.md §10, §13.4
export function isISODate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

export function startOfDayUTC(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return d;
}

export function endOfDayUTC(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
  return d;
}
