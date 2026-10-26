// Masking helpers for settings credentials.
// migration.md §13.6: 8 bullets plus a safe 4-char hint; bullets only for short values.
// Never return the raw value.
export function maskValue(value, hint = "") {
  if (value === "") return "";
  if (value.length > 8) {
    return "••••••••" + (hint !== "" ? hint : value.slice(-4));
  }
  return "••••••••";
}

export function googleClientIdHint(value) {
  if (!value) return "";
  const suffix = ".apps.googleusercontent.com";
  if (value.endsWith(suffix)) {
    const prefix = value.slice(0, -suffix.length);
    return prefix ? prefix.slice(-4) : "";
  }
  return value.slice(-4);
}
