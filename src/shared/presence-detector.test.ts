import { describe, expect, it } from "vitest";
import { detectPresence, ABSENCE_THRESHOLD_MS, LONG_ABSENCE_THRESHOLD_MS, isAbsence, isLongAbsence } from "../shared/presence-detector";
import type { ActivitySnapshot } from "../shared/types";

const now = 1_800_000_000_000;

function makeSnapshot(lastInteractionAt: number): ActivitySnapshot {
  return {
    capturedAt: now,
    pageLoadedAt: now - 60_000,
    lastInteractionAt,
    lastKeyboardAt: lastInteractionAt,
    lastPointerAt: lastInteractionAt,
    lastScrollAt: 0,
    lastClickAt: 0,
    interactionsIn30Seconds: 5,
    keyboardEventsIn30Seconds: 3,
    pageVisible: true,
    windowFocused: true,
    fullscreen: false,
    mediaPlaying: false,
  };
}

describe("presence-detector", () => {
  describe("detectPresence", () => {
    it("returns long_absence when gap exceeds LONG_ABSENCE_THRESHOLD", () => {
      const verdict = detectPresence(
        now,
        now - LONG_ABSENCE_THRESHOLD_MS - 1,
        now - LONG_ABSENCE_THRESHOLD_MS - 1,
        null,
      );
      expect(verdict).toBe("long_absence");
    });

    it("returns present when snapshot shows recent interaction", () => {
      const snapshot = makeSnapshot(now - 5_000); // 5s ago
      const verdict = detectPresence(now, now - 2 * 60_000, now - 60_000, snapshot);
      expect(verdict).toBe("present");
    });

    it("returns absent when snapshot shows interaction past threshold", () => {
      const snapshot = makeSnapshot(now - ABSENCE_THRESHOLD_MS - 1);
      const verdict = detectPresence(now, now - ABSENCE_THRESHOLD_MS - 1, now - ABSENCE_THRESHOLD_MS - 1, snapshot);
      expect(verdict).toBe("absent");
    });

    it("returns unknown when no snapshot and gap is small", () => {
      const verdict = detectPresence(
        now,
        now - 60_000,             // 1 minute gap
        now - 60_000,
        null,
      );
      expect(verdict).toBe("unknown");
    });

    it("returns absent when no snapshot and gap exceeds ABSENCE_THRESHOLD", () => {
      const verdict = detectPresence(
        now,
        now - ABSENCE_THRESHOLD_MS - 1,
        now - ABSENCE_THRESHOLD_MS - 1,
        null,
      );
      expect(verdict).toBe("absent");
    });

    it("long_absence beats snapshot signals", () => {
      // Even if the snapshot claims recent interaction, a huge clock gap wins.
      const snapshot = makeSnapshot(now - 1_000);
      const verdict = detectPresence(
        now,
        now - LONG_ABSENCE_THRESHOLD_MS - 1,
        now - LONG_ABSENCE_THRESHOLD_MS - 1,
        snapshot,
      );
      expect(verdict).toBe("long_absence");
    });
  });

  describe("isLongAbsence / isAbsence", () => {
    it("correctly classifies gap boundaries", () => {
      expect(isLongAbsence(LONG_ABSENCE_THRESHOLD_MS)).toBe(true);
      expect(isLongAbsence(LONG_ABSENCE_THRESHOLD_MS - 1)).toBe(false);
      expect(isAbsence(ABSENCE_THRESHOLD_MS)).toBe(true);
      expect(isAbsence(ABSENCE_THRESHOLD_MS - 1)).toBe(false);
    });
  });
});
