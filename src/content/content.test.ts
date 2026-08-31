/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultStats, createDefaultTimer, DEFAULT_SETTINGS } from "../shared/defaults";

interface TestContentRegistration {
  dispose: () => void;
}

const contentScope = globalThis as typeof globalThis & {
  __blinkBreakContent?: TestContentRegistration;
};
const addListener = vi.fn();
const removeListener = vi.fn();

beforeEach(() => {
  vi.resetModules();
  contentScope.__blinkBreakContent?.dispose();
  delete contentScope.__blinkBreakContent;
  addListener.mockClear();
  removeListener.mockClear();
  vi.stubGlobal("chrome", {
    runtime: {
      id: "test-extension",
      sendMessage: vi.fn().mockResolvedValue({
        ok: true,
        state: {
          settings: DEFAULT_SETTINGS,
          timer: createDefaultTimer(),
          stats: createDefaultStats(),
        },
      }),
      onMessage: { addListener, removeListener },
    },
  });
});

afterEach(() => {
  contentScope.__blinkBreakContent?.dispose();
  delete contentScope.__blinkBreakContent;
  vi.unstubAllGlobals();
});

describe("content runtime lifecycle", () => {
  it("disposes an older runtime before installing replacement listeners", async () => {
    await import("./content");
    expect(addListener).toHaveBeenCalledTimes(1);

    vi.resetModules();
    await import("./content");
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(addListener).toHaveBeenCalledTimes(2);
  });
});
