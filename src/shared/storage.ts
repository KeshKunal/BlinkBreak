import { DEFAULT_SETTINGS } from "./defaults";
import type { AppSnapshot, DailyStats, TimerState, UserSettings } from "./types";
import { sanitizeSettings, sanitizeStats, sanitizeTimer } from "./validation";

export const STORAGE_KEYS = {
  settings: "settings",
  timer: "timer",
  stats: "stats",
} as const;

function storageArea(): chrome.storage.StorageArea {
  if (!globalThis.chrome?.storage?.local) {
    throw new Error("Extension storage is unavailable");
  }
  return chrome.storage.local;
}

export async function loadAppSnapshot(now = Date.now()): Promise<AppSnapshot> {
  const stored = await storageArea().get(Object.values(STORAGE_KEYS));
  const settings = sanitizeSettings(stored[STORAGE_KEYS.settings] ?? DEFAULT_SETTINGS);
  const timer = sanitizeTimer(stored[STORAGE_KEYS.timer], settings, now);
  const stats = sanitizeStats(stored[STORAGE_KEYS.stats], new Date(now));
  return { settings, timer, stats };
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  await storageArea().set({ [STORAGE_KEYS.settings]: sanitizeSettings(settings) });
}

export async function saveTimer(timer: TimerState): Promise<void> {
  await storageArea().set({ [STORAGE_KEYS.timer]: timer });
}

export async function saveStats(stats: DailyStats): Promise<void> {
  await storageArea().set({ [STORAGE_KEYS.stats]: stats });
}

export async function saveAppSnapshot(snapshot: AppSnapshot): Promise<void> {
  await storageArea().set({
    [STORAGE_KEYS.settings]: snapshot.settings,
    [STORAGE_KEYS.timer]: snapshot.timer,
    [STORAGE_KEYS.stats]: snapshot.stats,
  });
}
