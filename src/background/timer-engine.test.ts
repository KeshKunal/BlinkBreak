import { describe, expect, it } from "vitest";
import {
  createDefaultStats,
  createDefaultTimer,
  DEFAULT_SETTINGS,
  MINUTE_MS,
} from "../shared/defaults";
import { ABSENCE_THRESHOLD_MS, LONG_ABSENCE_THRESHOLD_MS } from "../shared/presence-detector";
import {
  classifyGap,
  completeBreakInSnapshot,
  recoverAppSnapshot,
  recoverTimer,
  transitionTimer,
} from "./timer-engine";

describe("timer engine", () => {
  const now = 1_800_000_000_000;

  it("creates the initial schedule from the configured interval", () => {
    const timer = createDefaultTimer(now, DEFAULT_SETTINGS);
    expect(timer.status).toBe("counting");
    expect(timer.nextBreakDueAt).toBe(now + 15 * MINUTE_MS);
    expect(timer.exposureAccumulatedMs).toBe(0);
    expect(timer.exposureGoalMs).toBe(15 * MINUTE_MS);
  });

  it("pauses with remaining time and resumes from that duration", () => {
    const timer = createDefaultTimer(now, DEFAULT_SETTINGS);
    const paused = transitionTimer(timer, { type: "PAUSE" }, DEFAULT_SETTINGS, now + MINUTE_MS);
    const resumed = transitionTimer(paused, { type: "RESUME" }, DEFAULT_SETTINGS, now + 5 * MINUTE_MS);

    expect(paused.status).toBe("paused");
    expect(paused.remainingWhenPausedMs).toBe(14 * MINUTE_MS);
    expect(resumed.status).toBe("counting");
    expect(resumed.nextBreakDueAt).toBe(now + 19 * MINUTE_MS);
    // Exposure tracking resets on resume
    expect(resumed.exposureLastSampledAt).toBe(now + 5 * MINUTE_MS);
  });

  it("defers a due break and tracks repeated postponements", () => {
    const due = transitionTimer(
      createDefaultTimer(now, DEFAULT_SETTINGS),
      { type: "DUE" },
      DEFAULT_SETTINGS,
      now + 15 * MINUTE_MS,
    );
    const deferred = transitionTimer(
      due,
      { type: "DEFER", minutes: 5 },
      DEFAULT_SETTINGS,
      now + 15 * MINUTE_MS,
    );

    expect(deferred.status).toBe("deferred");
    expect(deferred.nextBreakDueAt).toBe(now + 20 * MINUTE_MS);
    expect(deferred.consecutiveDeferrals).toBe(1);
    // Exposure resets on defer
    expect(deferred.exposureAccumulatedMs).toBe(0);
  });

  it("completes an active break and schedules the next one", () => {
    const due = transitionTimer(
      createDefaultTimer(now, DEFAULT_SETTINGS),
      { type: "DUE" },
      DEFAULT_SETTINGS,
      now + 15 * MINUTE_MS,
    );
    const active = transitionTimer(due, { type: "START_BREAK" }, DEFAULT_SETTINGS, now);
    const complete = transitionTimer(active, { type: "COMPLETE" }, DEFAULT_SETTINGS, now + 20_000);

    expect(complete.status).toBe("counting");
    expect(complete.lastBreakCompletedAt).toBe(now + 20_000);
    expect(complete.nextBreakDueAt).toBe(now + 20_000 + 15 * MINUTE_MS);
    // Fresh exposure session after completing a break
    expect(complete.exposureAccumulatedMs).toBe(0);
  });

  it("SESSION_RESET resets exposure but preserves break history", () => {
    const timer = {
      ...createDefaultTimer(now, DEFAULT_SETTINGS),
      lastBreakCompletedAt: now - 30 * MINUTE_MS,
      exposureAccumulatedMs: 12 * MINUTE_MS,
    };
    const reset = transitionTimer(timer, { type: "SESSION_RESET" }, DEFAULT_SETTINGS, now);
    expect(reset.status).toBe("counting");
    expect(reset.exposureAccumulatedMs).toBe(0);
    expect(reset.lastBreakCompletedAt).toBe(now - 30 * MINUTE_MS); // preserved
  });

  it("recovers an expired active break without leaving a stuck state", () => {
    const timer = {
      ...createDefaultTimer(now, DEFAULT_SETTINGS),
      status: "break_active" as const,
      activeBreakStartedAt: now,
    };
    const recovered = recoverTimer(timer, DEFAULT_SETTINGS, now + 30_000);
    expect(recovered.status).toBe("counting");
    expect(recovered.nextBreakDueAt).toBe(now + 20_000 + 15 * MINUTE_MS);
  });

  it("recovers into SESSION_RESET after a long absence gap", () => {
    const timer = createDefaultTimer(now, DEFAULT_SETTINGS);
    // Simulate 3 hours elapsed (exposureLastSampledAt is at `now`, recovery at now+3h)
    const recovered = recoverTimer(timer, DEFAULT_SETTINGS, now + LONG_ABSENCE_THRESHOLD_MS + MINUTE_MS);
    expect(recovered.status).toBe("counting");
    // Fresh session — no instant break
    expect(recovered.exposureAccumulatedMs).toBe(0);
  });

  it("pushes deadline forward after a regular absence gap, no instant break", () => {
    const timer = createDefaultTimer(now, DEFAULT_SETTINGS);
    const absenceMs = ABSENCE_THRESHOLD_MS + MINUTE_MS;
    const recovered = recoverTimer(timer, DEFAULT_SETTINGS, now + absenceMs);
    expect(recovered.status).toBe("counting");
    expect(recovered.presenceState).toBe("absent");
    // nextBreakDueAt should be in the future
    expect(recovered.nextBreakDueAt).toBeGreaterThan(now + absenceMs);
  });

  it("marks as evaluating for short gap past deadline when exposure is due", () => {
    // Use a 5-minute interval so the total elapsed gap (5min + 2min = 7min)
    // stays below ABSENCE_THRESHOLD_MS (10 min), triggering the evaluating path.
    const shortSettings = { ...DEFAULT_SETTINGS, breakIntervalMinutes: 5 };
    const shortGoalMs = 5 * MINUTE_MS;
    const shortNow = now;
    const timer = {
      ...createDefaultTimer(shortNow, shortSettings),
      exposureAccumulatedMs: shortGoalMs, // exposure goal met
      exposureLastSampledAt: shortNow,
    };
    // 7 minutes elapsed: deadline passed (at 5min), only 7min gap < 10min absence threshold
    const recovered = recoverTimer(timer, shortSettings, shortNow + 7 * MINUTE_MS);
    expect(recovered.status).toBe("evaluating");
  });

  it("preserves paused state across recovery", () => {
    const paused = transitionTimer(createDefaultTimer(now, DEFAULT_SETTINGS), { type: "PAUSE" }, DEFAULT_SETTINGS, now);
    expect(recoverTimer(paused, DEFAULT_SETTINGS, now + 3 * 60 * 60_000).status).toBe("paused");
  });

  it("preserves completed-break statistics across a service-worker restart", () => {
    const active = {
      ...createDefaultTimer(now, DEFAULT_SETTINGS),
      status: "break_active" as const,
      activeBreakStartedAt: now + 15 * MINUTE_MS,
    };
    const recovered = recoverAppSnapshot(
      {
        settings: DEFAULT_SETTINGS,
        timer: active,
        stats: createDefaultStats(new Date(now)),
      },
      active.activeBreakStartedAt + 30_000,
    );

    expect(recovered.timer.status).toBe("counting");
    expect(recovered.stats.completed).toBe(1);
    expect(recovered.stats.totalBreakSeconds).toBe(20);
    expect(recovered.stats.totalCompletedIntervalMs).toBe(15 * MINUTE_MS);
  });

  describe("classifyGap", () => {
    it("classifies short gaps as unknown", () => {
      expect(classifyGap(5 * MINUTE_MS)).toBe("unknown");
    });
    it("classifies absent-range gaps as absent", () => {
      expect(classifyGap(ABSENCE_THRESHOLD_MS)).toBe("absent");
      expect(classifyGap(ABSENCE_THRESHOLD_MS + MINUTE_MS)).toBe("absent");
    });
    it("classifies long gaps as long_absence", () => {
      expect(classifyGap(LONG_ABSENCE_THRESHOLD_MS)).toBe("long_absence");
    });
  });
});
