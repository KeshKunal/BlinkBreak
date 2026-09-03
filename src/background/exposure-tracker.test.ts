import { describe, expect, it } from "vitest";
import { computeExposureUpdate, isExposureDue } from "../background/exposure-tracker";
import { createDefaultTimer, DEFAULT_SETTINGS, MINUTE_MS } from "../shared/defaults";
import { ABSENCE_THRESHOLD_MS, LONG_ABSENCE_THRESHOLD_MS } from "../shared/presence-detector";

const now = 1_800_000_000_000;
const settings = DEFAULT_SETTINGS;

describe("exposure-tracker", () => {
  describe("computeExposureUpdate", () => {
    it("accumulates full credit when present", () => {
      const timer = createDefaultTimer(now, settings);
      const update = computeExposureUpdate(timer, "present", now + 2 * MINUTE_MS, settings);
      expect(update.action).toBe("accumulate");
      expect(update.exposureAccumulatedMs).toBe(2 * MINUTE_MS);
      expect(update.presenceState).toBe("present");
    });

    it("caps credit at MAX_CREDIBLE_STEP_MS (5 min) per update", () => {
      const timer = createDefaultTimer(now, settings);
      // Gap of 30 minutes — should only credit 5 min.
      const update = computeExposureUpdate(timer, "present", now + 30 * MINUTE_MS, settings);
      expect(update.action).toBe("accumulate");
      expect(update.exposureAccumulatedMs).toBe(5 * MINUTE_MS);
    });

    it("applies 50% credit for unknown presence", () => {
      const timer = createDefaultTimer(now, settings);
      const update = computeExposureUpdate(timer, "unknown", now + 2 * MINUTE_MS, settings);
      expect(update.action).toBe("accumulate");
      expect(update.exposureAccumulatedMs).toBeCloseTo(MINUTE_MS, 0); // 50% of 2min
    });

    it("pauses exposure when absent", () => {
      const timer = { ...createDefaultTimer(now, settings), exposureAccumulatedMs: 3 * MINUTE_MS };
      const update = computeExposureUpdate(timer, "absent", now + 5 * MINUTE_MS, settings);
      expect(update.action).toBe("pause");
      expect(update.exposureAccumulatedMs).toBe(3 * MINUTE_MS); // unchanged
      // Deadline pushed forward
      const remaining = settings.breakIntervalMinutes * MINUTE_MS - 3 * MINUTE_MS;
      expect(update.newNextBreakDueAt).toBe(now + 5 * MINUTE_MS + remaining);
    });

    it("resets session on long_absence", () => {
      const timer = { ...createDefaultTimer(now, settings), exposureAccumulatedMs: 10 * MINUTE_MS };
      const update = computeExposureUpdate(timer, "long_absence", now + LONG_ABSENCE_THRESHOLD_MS + MINUTE_MS, settings);
      expect(update.action).toBe("session_reset");
      expect(update.exposureAccumulatedMs).toBe(0);
    });

    it("does not exceed the exposure goal", () => {
      const goalMs = settings.breakIntervalMinutes * MINUTE_MS;
      const timer = { ...createDefaultTimer(now, settings), exposureAccumulatedMs: goalMs - 30_000 };
      const update = computeExposureUpdate(timer, "present", now + 2 * MINUTE_MS, settings);
      expect(update.exposureAccumulatedMs).toBe(goalMs); // capped at goal
    });

    it("pushes newNextBreakDueAt to the future when present and remaining", () => {
      const timer = createDefaultTimer(now, settings);
      const update = computeExposureUpdate(timer, "present", now + MINUTE_MS, settings);
      const expectedRemaining = settings.breakIntervalMinutes * MINUTE_MS - MINUTE_MS;
      expect(update.newNextBreakDueAt).toBe(now + MINUTE_MS + expectedRemaining);
    });
  });

  describe("isExposureDue", () => {
    it("returns false when exposure is below the goal", () => {
      const timer = createDefaultTimer(now, settings);
      expect(isExposureDue(timer)).toBe(false);
    });

    it("returns true when exposure meets the goal", () => {
      const timer = {
        ...createDefaultTimer(now, settings),
        exposureAccumulatedMs: settings.breakIntervalMinutes * MINUTE_MS,
      };
      expect(isExposureDue(timer)).toBe(true);
    });
  });

  describe("session reset invariant", () => {
    it("long_absence resets exposure regardless of current accumulation", () => {
      const timer = {
        ...createDefaultTimer(now, settings),
        exposureAccumulatedMs: settings.breakIntervalMinutes * MINUTE_MS, // full goal
      };
      const update = computeExposureUpdate(timer, "long_absence", now + LONG_ABSENCE_THRESHOLD_MS + 1, settings);
      expect(update.action).toBe("session_reset");
      expect(update.exposureAccumulatedMs).toBe(0);
    });
  });

  describe("absence gap invariant", () => {
    it("absent does not count absence time as credit", () => {
      const timer = createDefaultTimer(now, settings);
      // User absent for 20 minutes
      const update = computeExposureUpdate(timer, "absent", now + 20 * MINUTE_MS, settings);
      expect(update.exposureAccumulatedMs).toBe(0); // no credit for absence
    });
  });
});
