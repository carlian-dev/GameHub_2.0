// Contract test normalization.
// Strips/replaces dynamic fields so PHP (pretty-printed) vs Node (compact) outputs
// can be compared field-by-field. Matches migration.md §16 normalized fields.
export const DYNAMIC_FIELDS = [
  "id",
  "sessionId",
  "tableId",
  "ref",
  "token",
  "link",
  "createdAt",
  "updatedAt",
  "startTime",
  "endTime",
  "closedAt",
  "paidAt",
  "db",
];

// Placeholder used to replace dynamic values so structure (presence/type) is
// preserved but exact values are ignored during diff.
const DYN = "<dyn>";

/** Recursively replace dynamic fields in an object/array with a placeholder. */
export function normalize(value) {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (DYNAMIC_FIELDS.includes(k)) {
        out[k] = DYN;
      } else {
        out[k] = normalize(v);
      }
    }
    return out;
  }
  return value;
}

/** Normalize only the top-level body of a response (keeps status/headers intact). */
export function normalizeResponse(res) {
  return {
    status: res.status,
    headers: res.headers,
    body: normalize(res.body),
  };
}
