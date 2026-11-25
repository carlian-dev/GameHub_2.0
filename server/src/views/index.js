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
  label,
  deviceCount,
  deviceLimit,
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
    label: label ?? null,
    deviceCount: deviceCount ?? 0,
    deviceLimit: deviceLimit ?? null,
    digits,
    period,
  };
}

export function twoFactorStatusView({
  enabled,
  method,
  devices,
  deviceLimit,
  enrolledAt,
  lastUsedAt,
  pending,
}) {
  return {
    ok: true,
    enabled: !!enabled,
    method: method || "totp",
    devices: (Array.isArray(devices) ? devices : []).map((device) => ({
      id: String(device?.id || ""),
      label: device?.label ?? null,
      createdAt: device?.createdAt ?? null,
      lastUsedAt: device?.lastUsedAt ?? null,
    })),
    deviceLimit: deviceLimit ?? null,
    enrolledAt: enrolledAt ?? null,
    lastUsedAt: lastUsedAt ?? null,
    pending: !!pending,
  };
}

export function meView({
  username,
  email,
  role,
  status,
  displayName,
  avatarUrl,
  authProvider,
  createdAt,
  googleLinked,
  twoFactorEnabled,
  version,
  features,
}) {
  return {
    ok: true,
    username: username ?? null,
    email: email ?? null,
    role,
    status,
    displayName: displayName ?? "",
    avatarUrl: avatarUrl ?? null,
    authProvider,
    createdAt,
    googleLinked,
    twoFactorEnabled: !!twoFactorEnabled,
    // Optimistic-concurrency revision: send it back with profile edits.
    version: Number(version) > 0 ? Number(version) : 1,
    // Switchable features this role currently has (super-admin RBAC matrix).
    features: Array.isArray(features) ? features : [],
  };
}

export function profileView({ displayName, avatarUrl, version }) {
  return {
    ok: true,
    displayName: displayName ?? "",
    avatarUrl: avatarUrl ?? null,
    version: Number(version) > 0 ? Number(version) : 1,
  };
}

export function invitationCheckView({ valid, email, role }) {
  return {
    ok: true,
    valid,
    email,
    role: role ?? "cashier",
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
