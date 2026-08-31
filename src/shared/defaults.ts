import type { DailyStats, TimerState, UserSettings } from "./types";

export const MINUTE_MS = 60_000;

export const DEFAULT_SETTINGS: UserSettings = {
  breakIntervalMinutes: 15,
  breakDurationSeconds: 20,
  smartInterruptionEnabled: false,
  sensitivity: "balanced",
  defaultDeferralMinutes: 5,
  soundEnabled: false,
  animationPreference: "system",
  theme: "system",
  dailyGoal: 8,
  onboardingComplete: false,
};

export function localDateKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createDefaultTimer(
  now = Date.now(),
  settings = DEFAULT_SETTINGS,
): TimerState {
  return {
    status: "counting",
    sessionStartedAt: now,
    lastBreakCompletedAt: null,
    nextBreakDueAt: now + settings.breakIntervalMinutes * MINUTE_MS,
    breakDeferredUntil: null,
    nextEvaluationAt: null,
    activeBreakStartedAt: null,
    remainingWhenPausedMs: null,
    consecutiveDeferrals: 0,
    lastTransitionAt: now,
  };
}

export function createDefaultStats(now = new Date()): DailyStats {
  return {
    date: localDateKey(now),
    completed: 0,
    deferred: 0,
    totalBreakSeconds: 0,
    focusSessions: 1,
    totalCompletedIntervalMs: 0,
    longestUninterruptedMs: 0,
  };
}
