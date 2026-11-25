/**
 * passwordStrength.js - Password strength evaluation & username security validation.
 *
 * Provides shared rules for:
 * - Evaluating password strength into Weak, Moderate, and Strong tiers.
 * - Enforcing minimum security thresholds (rejecting weak passwords).
 * - Validating username syntax, start/end bounds, consecutive symbols, and reserved words.
 */

export const PASSWORD_LEVELS = Object.freeze({
  WEAK: "weak",
  MODERATE: "moderate",
  STRONG: "strong",
});

const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "super_admin",
  "superadmin",
  "root",
  "system",
  "gamehub",
  "guest",
  "support",
  "api",
  "staff",
  "cashier",
  "null",
  "undefined",
]);

const COMMON_WEAK_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty123",
  "admin123",
  "gamehub123",
  "letmein123",
  "welcome123",
  "changeme123",
  "iloveyou123",
]);

/**
 * Validate cashier username for length, character bounds, and reserved words.
 *
 * @param {string} rawUsername
 * @returns {{ valid: boolean, error?: string, normalized?: string }}
 */
export function validateUsername(rawUsername) {
  if (typeof rawUsername !== "string") {
    return { valid: false, error: "Username must be a string." };
  }

  const username = rawUsername.trim().toLowerCase();

  if (username.length < 3 || username.length > 30) {
    return { valid: false, error: "Username must be between 3 and 30 characters." };
  }

  if (!/^[a-z0-9._-]+$/.test(username)) {
    return {
      valid: false,
      error: "Username may only contain lowercase letters, numbers, dots, underscores, or dashes.",
    };
  }

  if (!/^[a-z0-9]/.test(username) || !/[a-z0-9]$/.test(username)) {
    return {
      valid: false,
      error: "Username must start and end with a letter or number.",
    };
  }

  if (/[._-]{2,}/.test(username)) {
    return {
      valid: false,
      error: "Username cannot contain consecutive dots, underscores, or dashes.",
    };
  }

  if (RESERVED_USERNAMES.has(username)) {
    return {
      valid: false,
      error: "This username is reserved by the system. Please choose another.",
    };
  }

  return { valid: true, normalized: username };
}

/**
 * Evaluate password strength and return details including Weak, Moderate, Strong level.
 *
 * @param {string} rawPassword
 * @param {object} [context]
 * @param {string} [context.username]
 * @param {string} [context.firstName]
 * @param {string} [context.lastName]
 * @returns {{
 *   score: number,
 *   level: 'weak'|'moderate'|'strong'|'',
 *   label: string,
 *   isValid: boolean,
 *   checks: {
 *     length: boolean,
 *     cases: boolean,
 *     number: boolean,
 *     symbol: boolean,
 *     noUsername: boolean
 *   },
 *   message: string
 * }}
 */
export function evaluatePassword(rawPassword, context = {}) {
  const pw = typeof rawPassword === "string" ? rawPassword : "";
  const len = pw.length;

  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);

  const poolCount =
    (hasLower ? 1 : 0) +
    (hasUpper ? 1 : 0) +
    (hasNumber ? 1 : 0) +
    (hasSymbol ? 1 : 0);

  // Check personal information leakage
  const lowerPw = pw.toLowerCase();
  let containsPersonalInfo = false;
  const personalTerms = [context.username, context.firstName, context.lastName]
    .filter(Boolean)
    .map((t) => String(t).trim().toLowerCase())
    .filter((t) => t.length >= 3);

  for (const term of personalTerms) {
    if (lowerPw.includes(term)) {
      containsPersonalInfo = true;
      break;
    }
  }

  const isCommon = COMMON_WEAK_PASSWORDS.has(lowerPw);

  const checks = {
    length: len >= 8,
    cases: hasLower && hasUpper,
    number: hasNumber,
    symbol: hasSymbol,
    noUsername: !containsPersonalInfo,
  };

  if (len === 0) {
    return {
      score: 0,
      level: "",
      label: "",
      isValid: false,
      checks: {
        length: false,
        cases: false,
        number: false,
        symbol: false,
        noUsername: true,
      },
      message: "Please enter a password.",
    };
  }

  // Weak conditions:
  // 1. Length < 8
  // 2. Contains user name or username
  // 3. Only 1 character pool (e.g. only lowercase, only digits)
  // 4. Common weak pattern
  // 5. 8-9 chars with only 2 character pools (e.g., "password1" or "abcde123")
  const isWeak =
    len < 8 ||
    containsPersonalInfo ||
    isCommon ||
    poolCount < 2 ||
    (len < 10 && poolCount < 3);

  if (isWeak) {
    let message = "Password is too weak — add uppercase letters, numbers, or symbols.";
    if (len < 8) {
      message = "Password must be at least 8 characters.";
    } else if (containsPersonalInfo) {
      message = "Password is too weak: it should not contain your name or username.";
    } else if (isCommon) {
      message = "Password is too weak: this password is too common and predictable.";
    }

    return {
      score: 1,
      level: PASSWORD_LEVELS.WEAK,
      label: "Weak",
      isValid: false,
      checks,
      message,
    };
  }

  // Strong criteria:
  // - 10+ characters with at least 3 character pools, OR
  // - 8+ characters with all 4 character pools (lower, upper, number, symbol),
  // - AND does not contain personal info or common sequences.
  const isStrong = (len >= 10 && poolCount >= 3) || (len >= 8 && poolCount === 4);

  if (isStrong) {
    return {
      score: 3,
      level: PASSWORD_LEVELS.STRONG,
      label: "Strong",
      isValid: true,
      checks,
      message: "Strong password! Excellent account security.",
    };
  }

  // Otherwise Moderate:
  // - At least 8 characters with at least 3 pools (e.g., lower + upper + number), or 10+ with 2 pools.
  return {
    score: 2,
    level: PASSWORD_LEVELS.MODERATE,
    label: "Moderate",
    isValid: true,
    checks,
    message: "Moderate password — add symbols or more characters for maximum security.",
  };
}
