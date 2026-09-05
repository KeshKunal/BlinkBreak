/**
 * heuristics.ts
 *
 * Centralised behavioural thresholds and magic numbers.
 * Keeps logic modules clean and makes tuning easy.
 */

// ---------------------------------------------------------------------------
// Presence & Absence
// ---------------------------------------------------------------------------

/** No interaction for this long → user is treated as absent. */
export const ABSENCE_THRESHOLD_MS = 10 * 60_000;

/** Gap > 2 hours → treat as a fresh session rather than resuming. */
export const LONG_ABSENCE_THRESHOLD_MS = 2 * 60 * 60_000;

/** 
 * If the page is visible and focused but there are no interactions,
 * extend the absence threshold by this amount (passive reading).
 */
export const PASSIVE_READING_EXTENSION_MS = 15 * 60_000;


// ---------------------------------------------------------------------------
// Returning Grace Period
// ---------------------------------------------------------------------------

/** Minimum grace period when returning from an absence. */
export const RETURN_GRACE_MIN_MS = 30_000;

/** Maximum grace period when returning from an absence. */
export const RETURN_GRACE_MAX_MS = 60_000;


// ---------------------------------------------------------------------------
// Deferral & Confirmation
// ---------------------------------------------------------------------------

/** Maximum time to wait for a pause during high activity before forcing a prompt. */
export const MAX_DEFERRAL_MS = 10 * 60_000;

/** 
 * Minimum time the user must be inactive before an interaction lull 
 * is confirmed as a "natural pause" (prevents instant trigger on 5s pause).
 */
export const PAUSE_CONFIRMATION_MS = 15_000;

/** Minimum wait time between evaluations to prevent state oscillation. */
export const DECISION_COOLDOWN_MS = 10_000;
