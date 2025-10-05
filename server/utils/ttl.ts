 // server/utils/ttl.ts

/**
 * Centralized TTL helpers for auth flows.
 * Reads from env with safe defaults.
 *
 * ENV:
 *  - PASSWORD_RESET_TTL_MIN (default: 15)
 *  - EMAIL_VERIFY_TTL_HOURS (default: 24)
 */

const toInt = (v: string | undefined, fallback: number, min = 1, max = 10_000) => {
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) return fallback;
  const floored = Math.floor(n);
  return Math.min(floored, max);
};

// Raw values (minutes/hours)
export const RESET_TTL_MIN = toInt(process.env.PASSWORD_RESET_TTL_MIN, 15, 1, 60 * 24);
export const VERIFY_TTL_HOURS = toInt(process.env.EMAIL_VERIFY_TTL_HOURS, 24, 1, 24 * 365);

// Milliseconds
export const RESET_TTL_MS = RESET_TTL_MIN * 60 * 1000;
export const VERIFY_TTL_MS = VERIFY_TTL_HOURS * 60 * 60 * 1000;

// Expiry Date helpers
export const resetExpiresAt = (): Date => new Date(Date.now() + Math.max(0, RESET_TTL_MS));
export const verifyExpiresAt = (): Date => new Date(Date.now() + Math.max(0, VERIFY_TTL_MS));

// Optional: small helpers for consistent copy
export const resetTtlHuman = `${RESET_TTL_MIN} minute${RESET_TTL_MIN === 1 ? "" : "s"}`;
export const verifyTtlHuman = `${VERIFY_TTL_HOURS} hour${VERIFY_TTL_HOURS === 1 ? "" : "s"}`;
