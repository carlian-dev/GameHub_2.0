// Named Mongo queries + BSON conversions. Return plain objects.
// migration.md §13.8: ObjectId for _id, Date for timestamps, never write ISO
// strings into date fields, never return a Mongo document directly.
import { ObjectId } from "mongodb";

export function toStringId(id) {
  return id != null ? String(id) : null;
}

export function isObjectId(value) {
  return typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value);
}

export function toObjectId(value) {
  // Callers pass either a stored ObjectId (e.g. right after insertOne) or a
  // 24-hex string from a request path/body.
  if (value instanceof ObjectId) {
    return value;
  }
  if (!isObjectId(value)) {
    return null;
  }
  return new ObjectId(value);
}

export function dateToISO(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
