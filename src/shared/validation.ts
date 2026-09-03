import { DEFAULT_SETTINGS, createDefaultStats, createDefaultTimer, localDateKey, MINUTE_MS } from "./defaults";
import type { DailyStats, PresenceVerdict, TimerState, TimerStatus, UserSettings } from "./types";

const TIMER_STATUSES: TimerStatus[] = [
  "counting",
  "break_due",
  "evaluating",
  "waiting_for_pause",
  "break_active",
  "deferred",
  "paused",
];

const PRESENCE_VERDICTS: PresenceVerdict[] = ["present", "absent", "long_absence", "unknown"];

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function timestamp(value: unknown, fallback: number): number {
  return finiteNumber(value, fallback, 0, Number.MAX_SAFE_INTEGER);
}

export function sanitizeSettings(value: unknown): UserSettings {
  const source = record(value);
  const sensitivity = ["low", "balanced", "high"].includes(String(source.sensitivity))
    ? (source.sensitivity as UserSettings["sensitivity"])
    : DEFAULT_SETTINGS.sensitivity;
  const theme = ["system", "light", "dark"].includes(String(source.theme))
    ? (source.theme as UserSettings["theme"])
    : DEFAULT_SETTINGS.theme;
  const animationPreference = ["system", "full", "reduced"].includes(
    String(source.animationPreference),
  )
    ? (source.animationPreference as UserSettings["animationPreference"])
    : DEFAULT_SETTINGS.animationPreference;

  return {
    breakIntervalMinutes: finiteNumber(
      source.breakIntervalMinutes,
      DEFAULT_SETTINGS.breakIntervalMinutes,
      5,
      120,
    ),
    breakDurationSeconds: finiteNumber(
      source.breakDurationSeconds,
      DEFAULT_SETTINGS.breakDurationSeconds,
      10,
      120,
    ),
    smartInterruptionEnabled:
      typeof source.smartInterruptionEnabled === "boolean"
        ? source.smartInterruptionEnabled
        : DEFAULT_SETTINGS.smartInterruptionEnabled,
    sensitivity,
    defaultDeferralMinutes: finiteNumber(
      source.defaultDeferralMinutes,
      DEFAULT_SETTINGS.defaultDeferralMinutes,
      1,
      30,
    ),
    soundEnabled:
      typeof source.soundEnabled === "boolean"
        ? source.soundEnabled
        : DEFAULT_SETTINGS.soundEnabled,
    animationPreference,
    theme,
    dailyGoal: Math.round(finiteNumber(source.dailyGoal, DEFAULT_SETTINGS.dailyGoal, 1, 24)),
    onboardingComplete:
      typeof source.onboardingComplete === "boolean"
        ? source.onboardingComplete
        : DEFAULT_SETTINGS.onboardingComplete,
  };
}

export function sanitizeTimer(
  value: unknown,
  settings: UserSettings,
  now = Date.now(),
): TimerState {
  const fallback = createDefaultTimer(now, settings);
  const source = record(value);
  const status = TIMER_STATUSES.includes(source.status as TimerStatus)
    ? (source.status as TimerStatus)
    : fallback.status;
  const lastTransitionAt = timestamp(source.lastTransitionAt, fallback.lastTransitionAt);
  const activeBreakStartedAt =
    status === "break_active"
      ? source.activeBreakStartedAt === null || source.activeBreakStartedAt === undefined
        ? lastTransitionAt
        : timestamp(source.activeBreakStartedAt, lastTransitionAt)
      : null;

  const goalMs = settings.breakIntervalMinutes * MINUTE_MS;

  // Sanitize exposure fields — fall back gracefully for pre-upgrade stored state.
  const exposureGoalMs = finiteNumber(source.exposureGoalMs, goalMs, MINUTE_MS, 120 * MINUTE_MS);
  const exposureAccumulatedMs = finiteNumber(
    source.exposureAccumulatedMs,
    0,
    0,
    exposureGoalMs,
  );
  const exposureLastSampledAt = timestamp(source.exposureLastSampledAt, fallback.exposureLastSampledAt);
  const lastPresenceConfirmedAt = timestamp(
    source.lastPresenceConfirmedAt,
    fallback.lastPresenceConfirmedAt,
  );
  const presenceState: PresenceVerdict = PRESENCE_VERDICTS.includes(
    source.presenceState as PresenceVerdict,
  )
    ? (source.presenceState as PresenceVerdict)
    : "unknown";

  return {
    status,
    sessionStartedAt: timestamp(source.sessionStartedAt, fallback.sessionStartedAt),
    lastBreakCompletedAt:
      source.lastBreakCompletedAt === null
        ? null
        : timestamp(source.lastBreakCompletedAt, fallback.lastBreakCompletedAt ?? now),
    nextBreakDueAt: timestamp(source.nextBreakDueAt, fallback.nextBreakDueAt),
    breakDeferredUntil:
      source.breakDeferredUntil === null || source.breakDeferredUntil === undefined
        ? null
        : timestamp(source.breakDeferredUntil, now),
    nextEvaluationAt:
      source.nextEvaluationAt === null || source.nextEvaluationAt === undefined
        ? null
        : timestamp(source.nextEvaluationAt, now),
    activeBreakStartedAt,
    remainingWhenPausedMs:
      source.remainingWhenPausedMs === null || source.remainingWhenPausedMs === undefined
        ? null
        : finiteNumber(source.remainingWhenPausedMs, 0, 0, 120 * 60_000),
    consecutiveDeferrals: Math.round(finiteNumber(source.consecutiveDeferrals, 0, 0, 99)),
    lastTransitionAt,
    // Exposure tracking
    exposureAccumulatedMs,
    exposureGoalMs,
    exposureLastSampledAt,
    // Presence tracking
    lastPresenceConfirmedAt,
    presenceState,
  };
}

export function sanitizeStats(value: unknown, now = new Date()): DailyStats {
  const fallback = createDefaultStats(now);
  const source = record(value);
  if (source.date !== localDateKey(now)) return fallback;

  return {
    date: source.date,
    completed: Math.round(finiteNumber(source.completed, 0, 0, 10_000)),
    deferred: Math.round(finiteNumber(source.deferred, 0, 0, 10_000)),
    totalBreakSeconds: finiteNumber(source.totalBreakSeconds, 0, 0, 100_000_000),
    focusSessions: Math.round(finiteNumber(source.focusSessions, 1, 0, 10_000)),
    totalCompletedIntervalMs: finiteNumber(
      source.totalCompletedIntervalMs,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    longestUninterruptedMs: finiteNumber(
      source.longestUninterruptedMs,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}
