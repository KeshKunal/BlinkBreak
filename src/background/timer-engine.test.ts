import { describe, expect, it } from "vitest";
import {
  createDefaultStats,
  createDefaultTimer,
  DEFAULT_SETTINGS,
  MINUTE_MS,
} from "../shared/defaults";
import { recoverAppSnapshot, recoverTimer, transitionTimer } from "./timer-engine";

describe("timer engine", () => {
  const now = 1_800_000_000_000;

  it("creates the initial schedule from the configured interval", () => {
    const timer = createDefaultTimer(now, DEFAULT_SETTINGS);
    expect(timer.status).toBe("counting");
    expect(timer.nextBreakDueAt).toBe(now + 15 * MINUTE_MS);
  });

  it("pauses with remaining time and resumes from that duration", () => {
    const timer = createDefaultTimer(now, DEFAULT_SETTINGS);
    const paused = transitionTimer(timer, { type: "PAUSE" }, DEFAULT_SETTINGS, now + MINUTE_MS);
    const resumed = transitionTimer(paused, { type: "RESUME" }, DEFAULT_SETTINGS, now + 5 * MINUTE_MS);

    expect(paused.status).toBe("paused");
    expect(paused.remainingWhenPausedMs).toBe(14 * MINUTE_MS);
    expect(resumed.status).toBe("counting");
    expect(resumed.nextBreakDueAt).toBe(now + 19 * MINUTE_MS);
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
  });

  it("completes an active break and schedules the next one", () => {
    const due = transitionTimer(
      createDefaultTimer(now, DEFAULT_SETTINGS),
      { type: "DUE" },
      DEFAULT_SETTINGS,
      now + 15 * MINUTE_MS,
    );
    const prompt = transitionTimer(due, { type: "PROMPT" }, DEFAULT_SETTINGS, now);
    const active = transitionTimer(prompt, { type: "START_BREAK" }, DEFAULT_SETTINGS, now);
    const complete = transitionTimer(active, { type: "COMPLETE" }, DEFAULT_SETTINGS, now + 20_000);

    expect(complete.status).toBe("counting");
    expect(complete.lastBreakCompletedAt).toBe(now + 20_000);
    expect(complete.nextBreakDueAt).toBe(now + 20_000 + 15 * MINUTE_MS);
  });

  it("recovers an overdue schedule after browser restart", () => {
    const timer = createDefaultTimer(now, DEFAULT_SETTINGS);
    expect(recoverTimer(timer, DEFAULT_SETTINGS, timer.nextBreakDueAt + 1).status).toBe("evaluating");
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
});
