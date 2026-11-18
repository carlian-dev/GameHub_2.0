// JSON serializers = MVC "View". Exact field names, types, nullability.
// Never leak passwordHash or settings credentials.

export function healthView({ db, ping, healthcheckCount }) {
  return {
    ok: true,
    db,
    ping,
    healthcheck_count: healthcheckCount,
  };
}

export function loginView({ username, email, role }) {
  return {
    ok: true,
    username: username ?? null,
    email: email ?? null,
    role,
  };
}

/** Enrollment payload. The plaintext secret is returned exactly once. */
export function twoFactorSetupView({
  secret,
  otpauthUrl,
  qrDataUrl,
  issuer,
  account,
  digits,
  period,
}) {
  return {
    ok: true,
    secret,
    otpauthUrl,
    qrDataUrl,
    issuer,
    account,
    digits,
    period,
  };
}

export function twoFactorStatusView({ enabled, method, enrolledAt, lastUsedAt }) {
  return {
    ok: true,
    enabled: !!enabled,
    method: method || "totp",
    enrolledAt: enrolledAt ?? null,
    lastUsedAt: lastUsedAt ?? null,
  };
}

export function meView({
  username,
  email,
  role,
  status,
  displayName,
  authProvider,
  createdAt,
  googleLinked,
  twoFactorEnabled,
}) {
  return {
    ok: true,
    username: username ?? null,
    email: email ?? null,
    role,
    status,
    displayName: displayName ?? "",
    authProvider,
    createdAt,
    googleLinked,
    twoFactorEnabled: !!twoFactorEnabled,
  };
}

export function profileView({ displayName }) {
  return {
    ok: true,
    displayName: displayName ?? "",
  };
}

export function invitationCheckView({ valid, email }) {
  return {
    ok: true,
    valid,
    email,
  };
}

export function publicConfigView(integrations) {
  return {
    ok: true,
    integrations,
  };
}

export function adminIntegrationsView({ integrations }) {
  return {
    ok: true,
    integrations,
  };
}

export function activityView({ logs, total, limit }) {
  return {
    ok: true,
    logs,
    total,
    limit,
  };
}
