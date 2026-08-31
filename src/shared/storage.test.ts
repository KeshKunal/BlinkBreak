import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultStats, createDefaultTimer, DEFAULT_SETTINGS } from "./defaults";
import { loadAppSnapshot, loadAppSnapshotForStartup, saveSettings } from "./storage";

function installStorageMock(initial: Record<string, unknown> = {}) {
  const values = { ...initial };
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        async get(keys: string[]) {
          return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
        },
        async set(update: Record<string, unknown>) {
          Object.assign(values, update);
        },
      },
    },
  });
  return values;
}

afterEach(() => vi.unstubAllGlobals());

describe("local storage", () => {
  it("persists user settings in the local extension store", async () => {
    installStorageMock();
    await saveSettings({ ...DEFAULT_SETTINGS, breakIntervalMinutes: 25, theme: "dark" });
    const restored = await loadAppSnapshot(1_800_000_000_000);
    expect(restored.settings.breakIntervalMinutes).toBe(25);
    expect(restored.settings.theme).toBe("dark");
  });

  it("repairs malformed stored values on read", async () => {
    installStorageMock({
      settings: { breakIntervalMinutes: -500, theme: "ultraviolet" },
      timer: { status: "missing", nextBreakDueAt: "soon" },
    });
    const restored = await loadAppSnapshot(1_800_000_000_000);
    expect(restored.settings.breakIntervalMinutes).toBe(5);
    expect(restored.settings.theme).toBe("system");
    expect(restored.timer.status).toBe("counting");
  });

  it("avoids startup writes when persisted state is already canonical", async () => {
    const now = 1_800_000_000_000;
    installStorageMock({
      settings: { ...DEFAULT_SETTINGS },
      timer: createDefaultTimer(now, DEFAULT_SETTINGS),
      stats: createDefaultStats(new Date(now)),
    });

    const restored = await loadAppSnapshotForStartup(now);
    expect(restored.needsPersistence).toBe(false);
  });

  it("marks missing or repaired startup state for persistence", async () => {
    installStorageMock({ settings: { breakIntervalMinutes: -10 } });
    const restored = await loadAppSnapshotForStartup(1_800_000_000_000);
    expect(restored.needsPersistence).toBe(true);
  });
});
