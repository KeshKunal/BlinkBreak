/**
 * exposure-tracker.ts
 *
 * Computes presence-aware exposure updates for the timer.
 *
 * "Exposure" is meaningful screen time — time when the user is confirmed
 * present and active. It is distinct from wall-clock elapsed time:
 *
 *   - Sleep, browser idle, absence → exposure does NOT accumulate.
 *   - User present → exposure accumulates toward the break goal.
 *   - User unknown (restricted page) → conservative 50% credit.
 *   - Long absence (> 2h) → session reset, fresh interval.
 *
 * This module is stateless: it receives the current TimerState and presence
 * verdict and returns an ExposureUpdate that the controller applies and persists.
 */

import { MINUTE_MS } from "../shared/defaults";
import type { PresenceVerdict, TimerState, UserSettings } from "../shared/types";

/**
 * Maximum credible elapsed time to credit in a single update step.
 * Guards against large alarm drift or service-worker cold-start gaps
 * producing an unrealistically large exposure credit in one step.
 */
const MAX_CREDIBLE_STEP_MS = 5 * MINUTE_MS; // 5 minutes

/**
 * When presence is "unknown" (restricted page, no content script),
 * credit this fraction of elapsed time. Ensures the timer still advances
 * for users who primarily browse on internal pages, while not aggressively
 * counting time during absence.
 */
const UNKNOWN_PRESENCE_CREDIT_FACTOR = 0.5;

export type ExposureAction =
  | "accumulate"    // Exposure credited; timer advances
  | "pause"         // Absence detected; timer holds
  | "session_reset" // Long absence; fresh session

export interface ExposureUpdate {
  action: ExposureAction;
  exposureAccumulatedMs: number;
  exposureLastSampledAt: number;
  lastPresenceConfirmedAt: number;
  presenceState: PresenceVerdict;
  /** Re-derived nextBreakDueAt for the alarm scheduler. */
  newNextBreakDueAt: number;
  reason: string;
}

/**
 * Compute an exposure update given the current timer state and presence verdict.
 *
 * The caller must apply the returned update to the TimerState and persist it.
 */
export function computeExposureUpdate(
  timer: TimerState,
  presence: PresenceVerdict,
  now: number,
  settings: UserSettings,
): ExposureUpdate {
  const gap = Math.max(0, now - timer.exposureLastSampledAt);

  // --- Long absence: full session reset ---
  if (presence === "long_absence") {
    const goalMs = settings.breakIntervalMinutes * MINUTE_MS;
    return {
      action: "session_reset",
      exposureAccumulatedMs: 0,
      exposureLastSampledAt: now,
      lastPresenceConfirmedAt: now,
      presenceState: "unknown",
      newNextBreakDueAt: now + goalMs,
      reason: `Long absence detected (${Math.round(gap / 60_000)}min); session reset`,
    };
  }

  // --- Regular absence: pause exposure, push deadline forward ---
  if (presence === "absent") {
    const remaining = Math.max(0, timer.exposureGoalMs - timer.exposureAccumulatedMs);
    return {
      action: "pause",
      exposureAccumulatedMs: timer.exposureAccumulatedMs,
      exposureLastSampledAt: now,
      lastPresenceConfirmedAt: timer.lastPresenceConfirmedAt,
      presenceState: "absent",
      newNextBreakDueAt: now + remaining,
      reason: "User absent; exposure paused",
    };
  }

  // --- User present: full credit ---
  if (presence === "present") {
    const credit = Math.min(gap, MAX_CREDIBLE_STEP_MS);
    const goalMs = settings.breakIntervalMinutes * MINUTE_MS;
    const accumulated = Math.min(timer.exposureAccumulatedMs + credit, goalMs);
    const remaining = Math.max(0, goalMs - accumulated);
    return {
      action: "accumulate",
      exposureAccumulatedMs: accumulated,
      exposureLastSampledAt: now,
      lastPresenceConfirmedAt: now,
      presenceState: "present",
      newNextBreakDueAt: now + remaining,
      reason: `Exposure +${Math.round(credit / 1000)}s (present)`,
    };
  }

  // --- Unknown presence: conservative half-credit ---
  // presence === "unknown" (restricted page, cold start, no content script)
  const credit = Math.min(gap, MAX_CREDIBLE_STEP_MS) * UNKNOWN_PRESENCE_CREDIT_FACTOR;
  const goalMs = settings.breakIntervalMinutes * MINUTE_MS;
  const accumulated = Math.min(timer.exposureAccumulatedMs + credit, goalMs);
  const remaining = Math.max(0, goalMs - accumulated);
  return {
    action: "accumulate",
    exposureAccumulatedMs: accumulated,
    exposureLastSampledAt: now,
    lastPresenceConfirmedAt: timer.lastPresenceConfirmedAt,
    presenceState: "unknown",
    newNextBreakDueAt: now + remaining,
    reason: `Exposure +${Math.round(credit / 1000)}s (unknown presence, 50% credit)`,
  };
}

/**
 * Returns true if the accumulated exposure has met or exceeded the goal,
 * meaning the timer is due for a break evaluation.
 */
export function isExposureDue(timer: TimerState): boolean {
  return timer.exposureAccumulatedMs >= timer.exposureGoalMs;
}
