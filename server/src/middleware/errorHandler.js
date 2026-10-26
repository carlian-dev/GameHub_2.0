import { HttpError } from "../utils/HttpError.js";

const ALLOWED_CODES = [400, 401, 403, 404, 409, 410, 422, 502, 503];

export function errorHandler(err, req, res, next) {
  // Malformed JSON body -> 400, always JSON.
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ ok: false, error: "invalid JSON" });
  }

  // Mongo driver errors -> generic 503, never leak details.
  const name = err && err.name ? String(err.name) : "";
  const isMongo = /mongo/i.test(name);
  if (isMongo) {
    if (err && err.code === 11000) {
      return res.status(409).json({ ok: false, error: err.message || "duplicate key" });
    }
    // eslint-disable-next-line no-console
    console.error("[gamehub] db error:", err && err.message ? err.message : err);
    return res.status(503).json({ ok: false, error: "database unavailable, try again later" });
  }

  if (err instanceof HttpError) {
    const status = ALLOWED_CODES.includes(err.status) ? err.status : 500;
    const message = status === 500 ? "internal server error" : err.message;
    return res.status(status).json({ ok: false, error: message });
  }

  const status = err && (err.status || err.statusCode);
  if (typeof status === "number" && ALLOWED_CODES.includes(status)) {
    return res.status(status).json({ ok: false, error: err.message || "internal server error" });
  }

  // eslint-disable-next-line no-console
  console.error("[gamehub] unexpected error:", err && err.stack ? err.stack : err);
  return res.status(500).json({ ok: false, error: "internal server error" });
}
