import { describe, expect, it } from "vitest";
import type { ActivitySnapshot } from "../shared/types";
import { assessInterruption, assessInterruptionLegacy } from "./interruption-engine";

const now = 1_800_000_000_000;

function makeSnapshot(overrides: Partial<ActivitySnapshot> = {}): ActivitySnapshot {
  return {
    capturedAt: now,
    pageLoadedAt: now - 60_000,
    lastInteractionAt: now,
    lastKeyboardAt: 0,
    lastPointerAt: 0,
    lastScrollAt: 0,
    lastClickAt: 0,
    interactionsIn30Seconds: 0,
    keyboardEventsIn30Seconds: 0,
    pageVisible: true,
    windowFocused: true,
    fullscreen: false,
    mediaPlaying: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// New API: assessInterruption with InterruptionInput
// ---------------------------------------------------------------------------

describe("interruption engine — new API", () => {
  it("returns session_reset for long_absence", () => {
    const result = assessInterruption(
      { presence: "long_absence", context: "clear", snapshot: null, sensitivity: "balanced" },
      now,
    );
    expect(result.action).toBe("session_reset");
  });

  it("returns defer_absence when user is absent", () => {
    const result = assessInterruption(
      { presence: "absent", context: "clear", snapshot: null, sensitivity: "balanced" },
      now,
    );
    expect(result.action).toBe("defer_absence");
  });

  it("waits for context when busy (meeting)", () => {
    const result = assessInterruption(
      { presence: "present", context: "busy", snapshot: null, sensitivity: "balanced" },
      now,
    );
    expect(result.action).toBe("wait_for_context");
    expect(result.nextEvaluationMs).toBe(300_000);
  });

  it("waits for context when focused (fullscreen)", () => {
    const result = assessInterruption(
      { presence: "present", context: "focused", snapshot: null, sensitivity: "balanced" },
      now,
    );
    expect(result.action).toBe("wait_for_context");
  });

  it("waits for context when media is playing", () => {
    const result = assessInterruption(
      { presence: "present", context: "media", snapshot: null, sensitivity: "balanced" },
      now,
    );
    expect(result.action).toBe("wait_for_context");
  });

  it("waits for context when limited page and unknown presence", () => {
    const result = assessInterruption(
      { presence: "unknown", context: "limited", snapshot: null, sensitivity: "balanced" },
      now,
    );
    expect(result.action).toBe("wait_for_context");
  });

  it("shows break when context is clear and no snapshot (low risk)", () => {
    const result = assessInterruption(
      { presence: "present", context: "clear", snapshot: null, sensitivity: "balanced" },
      now,
    );
    expect(result.action).toBe("show_break");
  });

  it("shows break when user paused naturally", () => {
    const snapshot = makeSnapshot({ lastInteractionAt: now - 20_000 });
    const result = assessInterruption(
      { presence: "present", context: "clear", snapshot, sensitivity: "balanced" },
      now,
    );
    expect(result.action).toBe("show_break");
  });

  it("waits for pause when user is actively typing", () => {
    const snapshot = makeSnapshot({
      lastKeyboardAt: now - 500,
      keyboardEventsIn30Seconds: 18,
      interactionsIn30Seconds: 22,
    });
    const result = assessInterruption(
      { presence: "present", context: "clear", snapshot, sensitivity: "balanced" },
      now,
    );
    expect(result.action).toBe("wait_for_pause");
  });
});

// ---------------------------------------------------------------------------
// Legacy API compatibility — assessInterruptionLegacy
// (ensures old callers still work after the refactor)
// ---------------------------------------------------------------------------

describe("interruption engine — legacy API", () => {
  it("classifies rapid typing as high interruption risk", () => {
    const result = assessInterruptionLegacy(
      makeSnapshot({
        lastKeyboardAt: now - 500,
        keyboardEventsIn30Seconds: 18,
        interactionsIn30Seconds: 22,
      }),
      "balanced",
      now,
    );
    expect(result.risk).toBe("high");
    expect(result.reasons).toContain("Sustained typing");
  });

  it("treats fullscreen playback as high risk", () => {
    const result = assessInterruptionLegacy(
      makeSnapshot({ fullscreen: true, mediaPlaying: true, lastInteractionAt: now - 20_000 }),
      "balanced",
      now,
    );
    expect(result.risk).toBe("high");
  });

  it("waits during non-fullscreen media playback even without interaction", () => {
    const result = assessInterruptionLegacy(
      makeSnapshot({ mediaPlaying: true, lastInteractionAt: now - 60_000 }),
      "balanced",
      now,
    );
    expect(["medium", "high"]).toContain(result.risk);
  });

  it("recognizes a quiet window as a natural pause", () => {
    const result = assessInterruptionLegacy(
      makeSnapshot({ lastInteractionAt: now - 20_000 }),
      "balanced",
      now,
    );
    expect(result.risk).toBe("low");
    expect(result.reasons).toContain("Natural pause detected");
  });

  it("does not prompt in the first moments after navigation", () => {
    const result = assessInterruptionLegacy(
      makeSnapshot({ pageLoadedAt: now - 1_000, lastInteractionAt: now - 1_000 }),
      "balanced",
      now,
    );
    expect(result.risk).toBe("medium");
    expect(result.reasons).toContain("Page just changed");
  });

  it("degrades safely when a restricted page has no activity signal", () => {
    expect(assessInterruptionLegacy(null, "balanced", now).risk).toBe("low");
  });

  it("prohibits break popups on high-priority sites like Zoom and Meet", () => {
    const result = assessInterruptionLegacy(
      makeSnapshot({ isHighPrioritySite: true }),
      "balanced",
      now,
    );
    expect(result.risk).toBe("high");
    expect(result.reasons[0]).toContain("High-priority site active");
  });
});
