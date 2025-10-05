// Centralized branding constants for easy future renames / white‑labeling.
// All visible school name text should import from here instead of hardcoding.
export const SCHOOL_NAME_FULL = "Adonai And Grace Inc."; // Primary legal/marketing name
export const SCHOOL_NAME_SHORT = "Adonai & Grace";        // Short variant for tight UI spots
export const SCHOOL_NAME_LEGAL_SUFFIX = ".inc";           // If you need just the suffix
export const SCHOOL_MOTTO_NATIVE = "Active Minds, Gracious Hearts."; // Keep if still desired
export const SCHOOL_MOTTO_EN = "Light • Knowledge • Service";

// Convenience combined strings (avoid duplicating punctuation across code)
export const COPYRIGHT_LINE = `${SCHOOL_NAME_FULL}`;

// Helper to get display name variants
export function getSchoolName(opts?: { short?: boolean }) {
  return opts?.short ? SCHOOL_NAME_SHORT : SCHOOL_NAME_FULL;
}
