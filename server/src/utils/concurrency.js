// Optimistic concurrency helpers for user documents.
//
// Every account starts at `version: 1`. An edit request must send the version
// it last read. The write is applied only when the stored version still matches
// that value, and the new value becomes `expected + 1` (both in the same atomic
// updateOne). A stale version is a 409 conflict instead of a silent overwrite.
//
// Legacy documents written before versioning existed have no field; they are
// read as version 1 so the first edit upgrades them to 2. Run
// `npm run backfill:versions` once to set the field explicitly on every row.

/** Stored version, with missing/invalid legacy values treated as 1. */
export function userVersion(doc) {
  const n = Number(doc && doc.version);
  return Number.isSafeInteger(n) && n > 0 ? n : 1;
}

/**
 * Validate the version a client sent. A missing precondition is rejected so an
 * old/cached client cannot quietly skip OCC and overwrite newer edits.
 */
export function parseUserVersion(value) {
  if (value === undefined || value === null || value === "") {
    const err = new Error("version is required — reload the page and try again");
    err.status = 428;
    throw err;
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) {
    const err = new Error("version must be a positive integer");
    err.status = 422;
    throw err;
  }
  return n;
}

/** Filter fragment matching only the version the caller last read. */
export function userVersionFilter(expectedVersion) {
  if (expectedVersion === 1) {
    // Legacy rows count as version 1 even though the field is absent.
    return {
      $or: [{ version: 1 }, { version: { $exists: false } }],
    };
  }
  return { version: expectedVersion };
}

/** 409 raised when another writer already moved the document. */
export function versionConflict(currentVersion) {
  const err = new Error(
    `this account was changed by someone else (current version ${currentVersion}) — reload and try again`
  );
  err.status = 409;
  err.currentVersion = currentVersion;
  return err;
}
