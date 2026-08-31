/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityTracker } from "./activity-tracker";

const now = 1_800_000_000_000;
const sendMessage = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  sendMessage.mockClear();
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("activity reporting", () => {
  it("keeps ordinary page activity local", () => {
    const tracker = new ActivityTracker();
    tracker.start();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    vi.advanceTimersByTime(60_000);

    expect(sendMessage).not.toHaveBeenCalled();
    tracker.stop();
  });

  it("reports once after a quiet window when pause detection is active", () => {
    const tracker = new ActivityTracker();
    tracker.start();
    tracker.setReportingEnabled(true);

    vi.advanceTimersByTime(15_499);
    expect(sendMessage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ACTIVITY_UPDATE" }),
    );
    vi.advanceTimersByTime(60_000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    tracker.stop();
  });

  it("resets and cancels the quiet signal after new activity or shutdown", () => {
    const tracker = new ActivityTracker();
    tracker.start();
    tracker.setReportingEnabled(true);
    vi.advanceTimersByTime(10_000);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    vi.advanceTimersByTime(15_000);
    expect(sendMessage).not.toHaveBeenCalled();

    tracker.stop();
    vi.advanceTimersByTime(60_000);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
