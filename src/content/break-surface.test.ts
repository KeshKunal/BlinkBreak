/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultStats, createDefaultTimer, DEFAULT_SETTINGS } from "../shared/defaults";
import type { AppSnapshot } from "../shared/types";
import { BreakSurface } from "./break-surface";

const now = 1_800_000_000_000;
const sendMessage = vi.fn();

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
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  sendMessage.mockReset();
  sendMessage.mockResolvedValue({
    ok: true,
    state: {
      ...activeState(),
      timer: createDefaultTimer(now + DEFAULT_SETTINGS.breakDurationSeconds * 1_000),
    },
  });
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
});

afterEach(() => {
  document.getElementById("blinkbreak-break-surface")?.remove();
  vi.unstubAllGlobals();
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

  it("keeps only one break surface when another runtime mounts", () => {
    const first = new BreakSurface();
    const second = new BreakSurface();

    try {
      first.showActive(activeState());
      second.showActive(activeState());
      vi.advanceTimersByTime(30);

      expect(document.querySelectorAll("#blinkbreak-break-surface")).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      first.hide();
      second.hide();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops timer and animation work while the page is hidden", () => {
    const surface = new BreakSurface();
    surface.showActive(activeState());
    vi.advanceTimersByTime(30);
    expect(vi.getTimerCount()).toBe(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(0);
    expect(
      document.getElementById("blinkbreak-break-surface")?.hasAttribute("data-page-hidden"),
    ).toBe(true);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(vi.getTimerCount()).toBe(1);

    surface.hide();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears delayed focus work when dismissed", () => {
    const surface = new BreakSurface();
    surface.showPrompt(activeState());
    expect(vi.getTimerCount()).toBe(1);
    surface.hide();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dismisses the completion acknowledgement after 1.5 seconds", async () => {
    const surface = new BreakSurface();
    surface.showActive(activeState());
    await vi.advanceTimersByTimeAsync(DEFAULT_SETTINGS.breakDurationSeconds * 1_000);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "COMPLETE_BREAK" }),
    );
    expect(document.getElementById("blinkbreak-break-surface")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1_499);
    expect(document.getElementById("blinkbreak-break-surface")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(document.getElementById("blinkbreak-break-surface")).toBeNull();
  });
});
