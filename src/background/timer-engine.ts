/**
 * timer-engine.ts
 *
 * Pure break-state reducer and exposure-aware restart recovery.
 *
 * Key invariant: wall-clock elapsed time alone does NOT advance the timer
 * or trigger a break. The ExposureTracker and PresenceDetector mediate
 * all time-based decisions before reaching this module.
 *
 * `recoverAppSnapshot` no longer fires a break simply because a stored
 * timestamp is in the past. Instead it classifies the elapsed gap as
 * presence-aware and delegates to the four-concept model.
 */

import { MINUTE_MS, createDefaultTimer } from "../shared/defaults";
import { LONG_ABSENCE_THRESHOLD_MS, ABSENCE_THRESHOLD_MS } from "../shared/presence-detector";
import type { AppSnapshot, PresenceVerdict, TimerState, UserSettings } from "../shared/types";
import type { ExposureUpdate } from "./exposure-tracker";

export type TimerEvent =
  | { type: "DUE" }
  | { type: "WAIT_FOR_PAUSE"; delayMs: number }
  | { type: "START_BREAK" }
  | { type: "DEFER"; minutes: number }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "COMPLETE" }
  | { type: "INTERVAL_CHANGED" }
  | { type: "EXPOSURE_UPDATE"; update: ExposureUpdate }
  | { type: "SESSION_RESET" };

export function transitionTimer(
  state: TimerState,
  event: TimerEvent,
  settings: UserSettings,
  now = Date.now(),
): TimerState {
  switch (event.type) {
    case "DUE":
      if (["paused", "break_active"].includes(state.status)) return state;
      return {
        ...state,
        status: "evaluating",
        nextEvaluationAt: null,
        lastTransitionAt: now,
      };

    case "WAIT_FOR_PAUSE":
      if (!["break_due", "evaluating", "waiting_for_pause"].includes(state.status)) return state;
      return {
        ...state,
        status: "waiting_for_pause",
        nextEvaluationAt: now + Math.max(30_000, event.delayMs),
        lastTransitionAt: now,
      };

    case "START_BREAK":
      if (state.status === "paused" || state.status === "break_active") return state;
      return {
        ...state,
        status: "break_active",
        activeBreakStartedAt: now,
        nextEvaluationAt: null,
        lastTransitionAt: now,
      };

    case "DEFER": {
      if (state.status === "paused") return state;
      const until = now + Math.max(1, Math.min(30, event.minutes)) * MINUTE_MS;
      const goalMs = state.exposureGoalMs;
      return {
        ...state,
        status: "deferred",
        nextBreakDueAt: until,
        breakDeferredUntil: until,
        nextEvaluationAt: null,
        activeBreakStartedAt: null,
        consecutiveDeferrals: state.consecutiveDeferrals + 1,
        lastTransitionAt: now,
        // Reset exposure so the deferred interval counts fresh time.
        exposureAccumulatedMs: 0,
        exposureGoalMs: goalMs,
        exposureLastSampledAt: now,
      };
    }

    case "PAUSE": {
      if (state.status === "paused") return state;
      const remaining = ["counting", "deferred"].includes(state.status)
        ? Math.max(0, state.nextBreakDueAt - now)
        : 0;
      return {
        ...state,
        status: "paused",
        remainingWhenPausedMs: remaining,
        nextEvaluationAt: null,
        activeBreakStartedAt: null,
        lastTransitionAt: now,
      };
    }

    case "RESUME":
      if (state.status !== "paused") return state;
      return {
        ...state,
        status: "counting",
        nextBreakDueAt: now + Math.max(0, state.remainingWhenPausedMs ?? 0),
        breakDeferredUntil: null,
        remainingWhenPausedMs: null,
        sessionStartedAt: now,
        lastTransitionAt: now,
        // Resume exposure tracking from the current accumulated value.
        exposureLastSampledAt: now,
        lastPresenceConfirmedAt: now,
        presenceState: "unknown",
      };

    case "COMPLETE":
      if (state.status !== "break_active") return state;
      return {
        ...state,
        status: "counting",
        sessionStartedAt: now,
        lastBreakCompletedAt: now,
        nextBreakDueAt: now + settings.breakIntervalMinutes * MINUTE_MS,
        breakDeferredUntil: null,
        nextEvaluationAt: null,
        activeBreakStartedAt: null,
        remainingWhenPausedMs: null,
        consecutiveDeferrals: 0,
        lastTransitionAt: now,
        // Fresh exposure session after completing a break.
        exposureAccumulatedMs: 0,
        exposureGoalMs: settings.breakIntervalMinutes * MINUTE_MS,
        exposureLastSampledAt: now,
        lastPresenceConfirmedAt: now,
        presenceState: "unknown",
      };

    case "INTERVAL_CHANGED":
      if (state.status !== "counting") return state;
      return {
        ...state,
        nextBreakDueAt: now + settings.breakIntervalMinutes * MINUTE_MS,
        exposureGoalMs: settings.breakIntervalMinutes * MINUTE_MS,
        lastTransitionAt: now,
      };

    case "EXPOSURE_UPDATE": {
      const u = event.update;
      return {
        ...state,
        nextBreakDueAt: u.newNextBreakDueAt,
        exposureAccumulatedMs: u.exposureAccumulatedMs,
        exposureLastSampledAt: u.exposureLastSampledAt,
        lastPresenceConfirmedAt: u.lastPresenceConfirmedAt,
        presenceState: u.presenceState,
        lastTransitionAt: now,
      };
    }

    case "SESSION_RESET": {
      // Long absence: reset to a fresh session. Preserve break history.
      const fresh = createDefaultTimer(now, settings);
      return {
        ...fresh,
        // Carry over historical fields.
        lastBreakCompletedAt: state.lastBreakCompletedAt,
        sessionStartedAt: now,
        lastTransitionAt: now,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Exposure-aware recovery
// ---------------------------------------------------------------------------

/**
 * Classifies the elapsed gap at service-worker startup to determine whether
 * the stored timer state can be resumed or requires adjustment.
 *
 * Important: this does NOT fire a break simply because nextBreakDueAt is in
 * the past. It checks the gap against absence thresholds first.
 */
export function recoverTimer(
  state: TimerState,
  settings: UserSettings,
  now = Date.now(),
): TimerState {
  if (state.status === "paused") return state;

  // Always complete an in-progress break if its duration has elapsed.
  if (state.status === "break_active") {
    const completionAt = (state.activeBreakStartedAt ?? now) + settings.breakDurationSeconds * 1000;
    if (completionAt > now) return state;
    return transitionTimer(state, { type: "COMPLETE" }, settings, completionAt);
  }

  const gap = Math.max(0, now - state.exposureLastSampledAt);

  // Long absence: full session reset — do not present an overdue break.
  if (gap >= LONG_ABSENCE_THRESHOLD_MS) {
    return transitionTimer(state, { type: "SESSION_RESET" }, settings, now);
  }

  // Regular absence: push the deadline forward so the break is not immediately due.
  if (gap >= ABSENCE_THRESHOLD_MS) {
    const remaining = Math.max(0, state.exposureGoalMs - state.exposureAccumulatedMs);
    return {
      ...state,
      nextBreakDueAt: now + remaining,
      exposureLastSampledAt: now,
      presenceState: "absent",
      lastTransitionAt: now,
    };
  }

  // Short gap (< 10 min): resume normally. Mark as evaluating if the deadline
  // has passed (the controller will evaluate break conditions properly).
  if (["waiting_for_pause"].includes(state.status) && (state.nextEvaluationAt ?? 0) > now) {
    return state;
  }
  if (["counting", "deferred"].includes(state.status) && state.nextBreakDueAt > now) {
    return state;
  }

  // Deadline passed within the short-gap window: mark as evaluating.
  // The controller's evaluateDueBreak will run the four-concept check.
  return transitionTimer(state, { type: "DUE" }, settings, now);
}

// ---------------------------------------------------------------------------
// Break completion with statistics
// ---------------------------------------------------------------------------

export function completeBreakInSnapshot(
  state: AppSnapshot,
  elapsedSeconds: number,
  completedAt = Date.now(),
): AppSnapshot {
  if (state.timer.status !== "break_active") return state;
  const focusEndedAt = state.timer.activeBreakStartedAt ?? completedAt;
  const uninterruptedMs = Math.max(0, focusEndedAt - state.timer.sessionStartedAt);
  return {
    ...state,
    timer: transitionTimer(state.timer, { type: "COMPLETE" }, state.settings, completedAt),
    stats: {
      ...state.stats,
      completed: state.stats.completed + 1,
      totalBreakSeconds:
        state.stats.totalBreakSeconds +
        Math.min(state.settings.breakDurationSeconds, Math.max(0, elapsedSeconds)),
      totalCompletedIntervalMs: state.stats.totalCompletedIntervalMs + uninterruptedMs,
      longestUninterruptedMs: Math.max(state.stats.longestUninterruptedMs, uninterruptedMs),
    },
  };
}

export function recoverAppSnapshot(state: AppSnapshot, now = Date.now()): AppSnapshot {
  const startedAt = state.timer.activeBreakStartedAt;
  if (state.timer.status === "break_active" && startedAt !== null) {
    const completedAt = startedAt + state.settings.breakDurationSeconds * 1_000;
    if (completedAt <= now) {
      const completed = completeBreakInSnapshot(
        state,
        state.settings.breakDurationSeconds,
        completedAt,
      );
      const timer = recoverTimer(completed.timer, completed.settings, now);
      return timer === completed.timer ? completed : { ...completed, timer };
    }
  }

  const timer = recoverTimer(state.timer, state.settings, now);
  return timer === state.timer ? state : { ...state, timer };
}

// ---------------------------------------------------------------------------
// Presence verdict helper — used by recoverTimer (kept internal)
// ---------------------------------------------------------------------------

/** @internal Exported only for tests. */
export function classifyGap(gapMs: number): PresenceVerdict {
  if (gapMs >= LONG_ABSENCE_THRESHOLD_MS) return "long_absence";
  if (gapMs >= ABSENCE_THRESHOLD_MS) return "absent";
  return "unknown";
}
