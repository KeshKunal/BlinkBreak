import { describe, expect, it } from "vitest";
import type { ActivitySnapshot } from "../shared/types";
import { assessInterruption } from "./interruption-engine";

const now = 1_800_000_000_000;

function snapshot(overrides: Partial<ActivitySnapshot> = {}): ActivitySnapshot {
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

describe("interruption engine", () => {
  it("classifies rapid typing as high interruption risk", () => {
    const result = assessInterruption(
      snapshot({
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
    const result = assessInterruption(
      snapshot({ fullscreen: true, mediaPlaying: true, lastInteractionAt: now - 20_000 }),
      "balanced",
      now,
    );
    expect(result.risk).toBe("high");
  });

  it("waits during non-fullscreen media playback even without interaction", () => {
    const result = assessInterruption(
      snapshot({ mediaPlaying: true, lastInteractionAt: now - 60_000 }),
      "balanced",
      now,
    );
    expect(["medium", "high"]).toContain(result.risk);
  });

  it("recognizes a quiet window as a natural pause", () => {
    const result = assessInterruption(
      snapshot({ lastInteractionAt: now - 20_000 }),
      "balanced",
      now,
    );
    expect(result.risk).toBe("low");
    expect(result.reasons).toContain("Natural pause detected");
  });

  it("does not prompt in the first moments after navigation", () => {
    const result = assessInterruption(
      snapshot({ pageLoadedAt: now - 1_000, lastInteractionAt: now - 1_000 }),
      "balanced",
      now,
    );
    expect(result.risk).toBe("medium");
    expect(result.reasons).toContain("Page just changed");
  });

  it("transitions from high to low when the user pauses", () => {
    const busy = assessInterruption(
      snapshot({
        lastInteractionAt: now,
        lastKeyboardAt: now,
        keyboardEventsIn30Seconds: 12,
        interactionsIn30Seconds: 15,
      }),
      "balanced",
      now,
    );
    const quiet = assessInterruption(
      snapshot({ lastInteractionAt: now - 16_000 }),
      "balanced",
      now,
    );
    expect(busy.risk).toBe("high");
    expect(quiet.risk).toBe("low");
  });

  it("degrades safely when a restricted page has no activity signal", () => {
    expect(assessInterruption(null, "balanced", now).risk).toBe("low");
  });

  it("prohibits break popups on high-priority sites like Zoom and Meet", () => {
    const result = assessInterruption(
      snapshot({ isHighPrioritySite: true }),
      "balanced",
      now,
    );
    expect(result.risk).toBe("high");
    expect(result.reasons[0]).toContain("High-priority site active");
  });
});
