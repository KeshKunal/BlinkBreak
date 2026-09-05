import { describe, expect, it } from "vitest";
import { MINUTE_MS, createDefaultTimer } from "../src/shared/defaults";
import { ABSENCE_THRESHOLD_MS, MAX_DEFERRAL_MS, PAUSE_CONFIRMATION_MS } from "../src/shared/heuristics";
import { detectPresence } from "../src/shared/presence-detector";
import { assessInterruption } from "../src/background/interruption-engine";
import { recoverTimer } from "../src/background/timer-engine";
import type { ActivitySnapshot, UserSettings } from "../src/shared/types";
import { detectContext } from "../src/shared/context-detector";

const DEFAULT_SETTINGS: UserSettings = {
  breakIntervalMinutes: 15,
  breakDurationSeconds: 20,
  smartInterruptionEnabled: true,
  sensitivity: "balanced",
  defaultDeferralMinutes: 5,
  soundEnabled: false,
  animationPreference: "system",
  theme: "system",
  dailyGoal: 8,
  onboardingComplete: true,
};

function createSnapshot(overrides: Partial<ActivitySnapshot>): ActivitySnapshot {
  return {
    capturedAt: Date.now(),
    pageLoadedAt: Date.now() - 60_000,
    lastInteractionAt: Date.now() - 5_000,
    lastKeyboardAt: Date.now() - 5_000,
    lastPointerAt: Date.now() - 5_000,
    lastScrollAt: Date.now() - 5_000,
    lastClickAt: Date.now() - 5_000,
    interactionsIn30Seconds: 5,
    keyboardEventsIn30Seconds: 2,
    pageVisible: true,
    windowFocused: true,
    fullscreen: false,
    mediaPlaying: false,
    ...overrides,
  };
}

describe("Behavioral Hardening Rules", () => {
  it("5 sec pause while coding → no break (wait_for_pause)", () => {
    const now = Date.now();
    const snapshot = createSnapshot({
      lastInteractionAt: now - 5_000,
      lastKeyboardAt: now - 5_000,
      keyboardEventsIn30Seconds: 15, // High typing pace
    });

    const decision = assessInterruption(
      {
        presence: "present",
        context: "clear",
        snapshot,
        sensitivity: "balanced",
      },
      now,
    );

    expect(decision.action).toBe("wait_for_pause");
  });

  it("PAUSE_CONFIRMATION_MS pause while coding → evaluate (show_break)", () => {
    const now = Date.now();
    const snapshot = createSnapshot({
      lastInteractionAt: now - PAUSE_CONFIRMATION_MS, // Natural pause achieved
      lastKeyboardAt: now - PAUSE_CONFIRMATION_MS,
      keyboardEventsIn30Seconds: 0, 
    });

    const decision = assessInterruption(
      {
        presence: "present",
        context: "clear",
        snapshot,
        sensitivity: "balanced",
      },
      now,
    );

    expect(decision.action).toBe("show_break");
  });

  it("maximum deferral + active meeting → continue waiting", () => {
    const now = Date.now();
    const snapshot = createSnapshot({
      workType: "meeting", // High priority context
    });
    
    const context = detectContext(snapshot, "https://meet.google.com/abc", "evaluating", "injectable");

    const decision = assessInterruption(
      {
        presence: "present",
        context, // will be 'busy'
        snapshot,
        sensitivity: "balanced",
        maxDeferralStartedAt: now - MAX_DEFERRAL_MS - 1000, // Exceeded max deferral
      },
      now,
    );

    // Max deferral does NOT override busy context
    expect(decision.action).toBe("wait_for_context");
  });

  it("maximum deferral + normal clear context (high activity) → show", () => {
    const now = Date.now();
    const snapshot = createSnapshot({
      lastInteractionAt: now,
      lastKeyboardAt: now,
      keyboardEventsIn30Seconds: 20, // very high risk
    });

    const decision = assessInterruption(
      {
        presence: "present",
        context: "clear",
        snapshot,
        sensitivity: "balanced",
        maxDeferralStartedAt: now - MAX_DEFERRAL_MS - 1000, // Exceeded max deferral
      },
      now,
    );

    // Max deferral overrides activity risk
    expect(decision.action).toBe("show_break");
  });

  it("visible/focused page + genuine absence → passive reading extension applies", () => {
    const now = Date.now();
    // No interaction for 11 minutes
    const lastInteractionAt = now - ABSENCE_THRESHOLD_MS - MINUTE_MS;
    
    // Normal case (not visible)
    const snapshotNotVisible = createSnapshot({
      lastInteractionAt,
      pageVisible: false,
      windowFocused: false,
    });
    
    expect(detectPresence(now, now - 11 * MINUTE_MS, now - 11 * MINUTE_MS, snapshotNotVisible)).toBe("absent");
    
    // Passive reading case
    const snapshotReading = createSnapshot({
      lastInteractionAt,
      pageVisible: true,
      windowFocused: true,
    });
    
    expect(detectPresence(now, now - 11 * MINUTE_MS, now - 11 * MINUTE_MS, snapshotReading)).toBe("present");
  });

  it("return from 35 min absence → short grace", () => {
    const now = Date.now();
    const state = createDefaultTimer(now - 120 * MINUTE_MS, DEFAULT_SETTINGS);
    // User was active up until 35 minutes ago
    state.exposureLastSampledAt = now - 35 * MINUTE_MS;
    state.exposureAccumulatedMs = 14 * MINUTE_MS;

    const recovered = recoverTimer(state, DEFAULT_SETTINGS, now);
    
    expect(recovered.returnGraceExpirationAt).toBeGreaterThan(now);
    expect(recovered.returnGraceExpirationAt).toBeLessThanOrEqual(now + 60_000);
    
    const decision = assessInterruption(
      {
        presence: "present",
        context: "clear",
        snapshot: createSnapshot({ lastInteractionAt: now }),
        sensitivity: "balanced",
        returnGraceExpirationAt: recovered.returnGraceExpirationAt,
      },
      now,
    );
    
    // During grace period, should wait_for_context
    expect(decision.action).toBe("wait_for_context");
  });

  it("return from 3 hr absence → fresh session", () => {
    const now = Date.now();
    const state = createDefaultTimer(now - 5 * 60 * MINUTE_MS, DEFAULT_SETTINGS);
    state.exposureLastSampledAt = now - 3 * 60 * MINUTE_MS;
    
    const recovered = recoverTimer(state, DEFAULT_SETTINGS, now);
    expect(recovered.sessionStartedAt).toBe(now); // Session reset
    expect(recovered.exposureAccumulatedMs).toBe(0);
  });
});
