import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultStats, createDefaultTimer, DEFAULT_SETTINGS } from "../shared/defaults";
import type { AppSnapshot } from "../shared/types";
import { ContentBridge } from "./content-bridge";

const state: AppSnapshot = {
  settings: DEFAULT_SETTINGS,
  timer: {
    ...createDefaultTimer(),
    status: "break_active",
    activeBreakStartedAt: Date.now(),
  },
  stats: createDefaultStats(),
};

afterEach(() => vi.unstubAllGlobals());

describe("content bridge break surface delivery", () => {
  it("confirms when the active page accepted the break surface", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 7 }]),
        sendMessage,
      },
    });

    await expect(new ContentBridge().showOnActiveTab(state, true)).resolves.toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(7, {
      type: "SHOW_ACTIVE_BREAK",
      state,
      playSound: true,
    });
  });

  it("reports a restricted page so the popup can remain as the sole fallback", async () => {
    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 7 }]),
        sendMessage: vi.fn().mockRejectedValue(new Error("Cannot access this page")),
      },
    });

    await expect(new ContentBridge().showOnActiveTab(state)).resolves.toBe(false);
  });
});
