/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultStats, createDefaultTimer, DEFAULT_SETTINGS } from "../shared/defaults";
import type { AppSnapshot } from "../shared/types";
import { BreakSurface } from "./break-surface";

const now = 1_800_000_000_000;

function activeState(): AppSnapshot {
  return {
    settings: { ...DEFAULT_SETTINGS, animationPreference: "reduced" },
    timer: {
      ...createDefaultTimer(now, DEFAULT_SETTINGS),
      status: "break_active",
      activeBreakStartedAt: now,
    },
    stats: createDefaultStats(new Date(now)),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
});

afterEach(() => {
  document.getElementById("blinkbreak-break-surface")?.remove();
  vi.useRealTimers();
});

describe("break surface rendering", () => {
  it("does not remount the dialog when the same active break is delivered again", () => {
    const surface = new BreakSurface();
    const state = activeState();

    surface.showActive(state);
    const firstHost = document.getElementById("blinkbreak-break-surface");
    expect(firstHost).not.toBeNull();

    surface.showActive({ ...state, stats: { ...state.stats } });
    expect(document.getElementById("blinkbreak-break-surface")).toBe(firstHost);
    expect(firstHost?.isConnected).toBe(true);

    surface.hide();
  });
});
