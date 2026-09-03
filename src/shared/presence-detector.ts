/**
 * presence-detector.ts
 *
 * Pure function that determines whether the user is at the computer.
 *
 * "Presence" is inferred from interaction recency and elapsed time gaps —
 * not from page visibility or window focus alone. A closed laptop lid leaves
 * those values unchanged; a long elapsed gap reveals the absence.
 *
 * Important distinctions:
 *   "unknown"  ≠  "absent"
 *   "absent"   ≠  TIMER_STOPPED
 *   "long_absence" → SESSION_RESET (not a break)
 *
 * This module is side-effect-free and can run in any extension context.
 */

import { 
  ABSENCE_THRESHOLD_MS, 
  LONG_ABSENCE_THRESHOLD_MS, 
  PASSIVE_READING_EXTENSION_MS 
} from "./heuristics";
import type { ActivitySnapshot, PresenceVerdict } from "./types";

/**
 * Determine the user's presence based on the elapsed gap since the last
 * exposure sample and the latest content-script snapshot (if available).
 *
 * @param now                    Current timestamp.
 * @param exposureLastSampledAt  When the ExposureTracker last updated state.
 * @param lastPresenceConfirmedAt When presence was last positively confirmed.
 * @param snapshot               Latest ActivitySnapshot, or null when unavailable.
 */
export function detectPresence(
  now: number,
  exposureLastSampledAt: number,
  lastPresenceConfirmedAt: number,
  snapshot: ActivitySnapshot | null,
): PresenceVerdict {
  const gap = Math.max(0, now - exposureLastSampledAt);

  // A gap larger than LONG_ABSENCE_THRESHOLD always wins — the user was
  // definitely away regardless of any other signal.
  if (gap >= LONG_ABSENCE_THRESHOLD_MS) return "long_absence";

  if (snapshot !== null) {
    // Content script is available — use its interaction timestamps.
    const timeSinceInteraction = Math.max(0, now - snapshot.lastInteractionAt);

    if (timeSinceInteraction < ABSENCE_THRESHOLD_MS) {
      // Recent interaction → present.
      return "present";
    }

    // Check for passive reading (visible and focused, even if no direct interaction)
    if (snapshot.pageVisible && snapshot.windowFocused) {
      if (timeSinceInteraction < ABSENCE_THRESHOLD_MS + PASSIVE_READING_EXTENSION_MS) {
        return "present";
      }
    }

    // No recent interaction, but not a long absence either.
    return "absent";
  }

  // No content script (restricted page, cold start).
  // Use the gap as a heuristic.
  if (gap >= ABSENCE_THRESHOLD_MS) return "absent";

  // Gap is small but we have no interaction signal.
  // Return "unknown" — conservative; do not assume absent prematurely.
  const timeSincePresence = Math.max(0, now - lastPresenceConfirmedAt);
  if (timeSincePresence >= ABSENCE_THRESHOLD_MS) return "absent";

  return "unknown";
}

/** Whether a gap constitutes a long absence requiring a session reset. */
export function isLongAbsence(gapMs: number): boolean {
  return gapMs >= LONG_ABSENCE_THRESHOLD_MS;
}

/** Whether a gap constitutes a regular absence (timer pauses, no break). */
export function isAbsence(gapMs: number): boolean {
  return gapMs >= ABSENCE_THRESHOLD_MS;
}
