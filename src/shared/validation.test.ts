import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./defaults";
import { sanitizeSettings, sanitizeTimer } from "./validation";

describe("settings validation", () => {
  it("returns defaults for malformed settings", () => {
    expect(sanitizeSettings({ breakIntervalMinutes: "never", theme: "neon" })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it("clamps custom values to safe product limits", () => {
    const settings = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      breakIntervalMinutes: 1,
      breakDurationSeconds: 900,
      dailyGoal: 2.8,
    });
    expect(settings.breakIntervalMinutes).toBe(5);
    expect(settings.breakDurationSeconds).toBe(120);
    expect(settings.dailyGoal).toBe(3);
  });

  it("recovers a malformed timer instead of crashing the UI", () => {
    const timer = sanitizeTimer({ status: "broken", nextBreakDueAt: "later" }, DEFAULT_SETTINGS, 10);
    expect(timer.status).toBe("counting");
    expect(timer.nextBreakDueAt).toBeGreaterThan(10);
  });

  it("repairs an active break that lost its start timestamp", () => {
    const timer = sanitizeTimer(
      { status: "break_active", activeBreakStartedAt: null, lastTransitionAt: 500 },
      DEFAULT_SETTINGS,
      1_000,
    );
    expect(timer.activeBreakStartedAt).toBe(500);
  });
});
