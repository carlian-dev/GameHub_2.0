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

export function meView({
  username,
  email,
  role,
  status,
  displayName,
  authProvider,
  createdAt,
  googleLinked,
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
