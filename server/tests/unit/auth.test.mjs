// Unit tests for the super-admin route scope.
// The role is intentionally least-privilege: it may only manage integrations,
// so operational admin/cashier routes must be rejected before a controller
// that merely checks for a login sees the request.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { superAdminScope } from "../../src/middleware/auth.js";

function scope({ role, method = "GET", path }) {
  const req = {
    session: role ? { user: { id: "u1", role } } : {},
    method,
    path,
  };
  let error = null;
  superAdminScope(req, {}, (err) => {
    error = err || null;
  });
  return error;
}

describe("superAdminScope", () => {
  it("blocks operational admin endpoints", () => {
    const err = scope({ role: "super_admin", path: "/admin/sessions" });
    assert.strictEqual(err && err.status, 403);
    assert.match(err.message, /only manage integrations/i);
  });

  it("blocks operational cashier endpoints", () => {
    const err = scope({
      role: "super_admin",
      method: "POST",
      path: "/cashier/sessions",
    });
    assert.strictEqual(err && err.status, 403);
  });

  it("blocks the full reservation list but not a public single lookup", () => {
    assert.strictEqual(
      scope({ role: "super_admin", path: "/reservations" })?.status,
      403
    );
    assert.strictEqual(
      scope({ role: "super_admin", path: "/reservations/ABC123" }),
      null
    );
  });

  it("allows its own integration endpoints and auth basics", () => {
    assert.strictEqual(
      scope({ role: "super_admin", path: "/super-admin/settings/integrations" }),
      null
    );
    assert.strictEqual(scope({ role: "super_admin", path: "/me" }), null);
    assert.strictEqual(
      scope({ role: "super_admin", method: "POST", path: "/logout" }),
      null
    );
  });

  it("does not affect other roles or guests", () => {
    assert.strictEqual(scope({ role: "admin", path: "/admin/sessions" }), null);
    assert.strictEqual(scope({ role: "cashier", path: "/cashier/sessions" }), null);
    assert.strictEqual(scope({ role: null, path: "/admin/sessions" }), null);
  });
});
