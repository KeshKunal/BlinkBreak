import { MINUTE_MS } from "../shared/defaults";
import type { AppSnapshot, TimerState, UserSettings } from "../shared/types";

export type TimerEvent =
  | { type: "DUE" }
  | { type: "WAIT_FOR_PAUSE"; delayMs: number }
  | { type: "START_BREAK" }
  | { type: "DEFER"; minutes: number }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "COMPLETE" }
  | { type: "INTERVAL_CHANGED" };

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
      return {
        ...state,
        status: "deferred",
        nextBreakDueAt: until,
        breakDeferredUntil: until,
        nextEvaluationAt: null,
        activeBreakStartedAt: null,
        consecutiveDeferrals: state.consecutiveDeferrals + 1,
        lastTransitionAt: now,
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
      };

    case "INTERVAL_CHANGED":
      if (state.status !== "counting") return state;
      return {
        ...state,
        nextBreakDueAt: now + settings.breakIntervalMinutes * MINUTE_MS,
        lastTransitionAt: now,
      };
  }
}

export function recoverTimer(
  state: TimerState,
  settings: UserSettings,
  now = Date.now(),
): TimerState {
  if (state.status === "paused") return state;

  if (state.status === "break_active") {
    const completionAt = (state.activeBreakStartedAt ?? now) + settings.breakDurationSeconds * 1000;
    if (completionAt > now) return state;
    return transitionTimer(state, { type: "COMPLETE" }, settings, completionAt);
  }

  if (state.status === "waiting_for_pause" && (state.nextEvaluationAt ?? 0) > now) return state;
  if (["counting", "deferred"].includes(state.status) && state.nextBreakDueAt > now) return state;
  return transitionTimer(state, { type: "DUE" }, settings, now);
}

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
