import { describe, expect, it } from "vitest";
import { detectContext } from "../shared/context-detector";
import type { ActivitySnapshot } from "../shared/types";

const now = 1_800_000_000_000;

function makeSnapshot(overrides: Partial<ActivitySnapshot> = {}): ActivitySnapshot {
  return {
    capturedAt: now,
    pageLoadedAt: now - 60_000,
    lastInteractionAt: now - 1_000,
    lastKeyboardAt: now - 2_000,
    lastPointerAt: now - 1_000,
    lastScrollAt: 0,
    lastClickAt: now - 1_000,
    interactionsIn30Seconds: 5,
    keyboardEventsIn30Seconds: 3,
    pageVisible: true,
    windowFocused: true,
    fullscreen: false,
    mediaPlaying: false,
    isHighPrioritySite: false,
    workType: "reading_browsing",
    ...overrides,
  };
}

describe("context-detector", () => {
  it("returns blocked when timer is paused", () => {
    expect(detectContext(makeSnapshot(), undefined, "paused", "injectable")).toBe("blocked");
  });

  it("returns limited when no snapshot and page is non-injectable", () => {
    expect(detectContext(null, "chrome://settings", "counting", "restricted_scheme")).toBe("limited");
  });

  it("returns busy for high-priority site URL", () => {
    expect(detectContext(null, "https://meet.google.com/abc-def-ghi", "counting", "injectable")).toBe("busy");
  });

  it("returns busy when snapshot marks isHighPrioritySite", () => {
    const snapshot = makeSnapshot({ isHighPrioritySite: true });
    expect(detectContext(snapshot, "https://example.com", "counting", "injectable")).toBe("busy");
  });

  it("returns busy when workType is meeting", () => {
    const snapshot = makeSnapshot({ workType: "meeting" });
    expect(detectContext(snapshot, "https://example.com", "counting", "injectable")).toBe("busy");
  });

  it("returns focused when fullscreen is active", () => {
    const snapshot = makeSnapshot({ fullscreen: true });
    expect(detectContext(snapshot, "https://example.com", "counting", "injectable")).toBe("focused");
  });

  it("returns media when media is playing (not fullscreen, not busy)", () => {
    const snapshot = makeSnapshot({ mediaPlaying: true });
    expect(detectContext(snapshot, "https://example.com", "counting", "injectable")).toBe("media");
  });

  it("returns clear for a normal page with no contraindications", () => {
    const snapshot = makeSnapshot();
    expect(detectContext(snapshot, "https://example.com", "counting", "injectable")).toBe("clear");
  });

  it("returns clear for extension page when a snapshot IS available", () => {
    // If somehow a snapshot exists (edge case), use it — context has signals.
    const snapshot = makeSnapshot();
    expect(detectContext(snapshot, "chrome-extension://abc/popup.html", "counting", "extension_page")).toBe("clear");
  });

  it("returns limited for extension page when snapshot is null", () => {
    expect(detectContext(null, "chrome-extension://abc/popup.html", "counting", "extension_page")).toBe("limited");
  });

  it("prioritises blocked over busy", () => {
    const snapshot = makeSnapshot({ isHighPrioritySite: true });
    expect(detectContext(snapshot, "https://meet.google.com/x", "paused", "injectable")).toBe("blocked");
  });
});
