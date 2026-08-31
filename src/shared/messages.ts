import type { ActivitySnapshot, AppSnapshot, UserSettings } from "./types";

export type ExtensionRequest =
  | { type: "GET_APP_STATE" }
  | { type: "UPDATE_SETTINGS"; patch: Partial<UserSettings> }
  | { type: "SYNC_SITE_ACCESS" }
  | { type: "PAUSE_TIMER" }
  | { type: "RESUME_TIMER" }
  | { type: "TAKE_BREAK_NOW" }
  | { type: "START_BREAK" }
  | { type: "COMPLETE_BREAK"; elapsedSeconds: number }
  | { type: "DEFER_BREAK"; minutes: number }
  | { type: "ACTIVITY_UPDATE"; snapshot: ActivitySnapshot }
  | { type: "GET_ACTIVITY_SNAPSHOT" };

export type BackgroundResponse =
  | { ok: true; state?: AppSnapshot }
  | { ok: false; error: string };

export type ContentCommand =
  | { type: "SHOW_BREAK_PROMPT"; state: AppSnapshot }
  | { type: "SHOW_ACTIVE_BREAK"; state: AppSnapshot; playSound?: boolean }
  | { type: "SET_ACTIVITY_TRACKING"; enabled: boolean }
  | { type: "HIDE_BREAK_UI" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isActivitySnapshot(value: unknown): value is ActivitySnapshot {
  if (!isRecord(value)) return false;
  const numeric = [
    "capturedAt",
    "pageLoadedAt",
    "lastInteractionAt",
    "lastKeyboardAt",
    "lastPointerAt",
    "lastScrollAt",
    "lastClickAt",
    "interactionsIn30Seconds",
    "keyboardEventsIn30Seconds",
  ];
  const boolean = ["pageVisible", "windowFocused", "fullscreen", "mediaPlaying"];
  return (
    numeric.every((key) => typeof value[key] === "number" && Number.isFinite(value[key])) &&
    boolean.every((key) => typeof value[key] === "boolean")
  );
}

export function isExtensionRequest(value: unknown): value is ExtensionRequest {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "GET_APP_STATE":
    case "PAUSE_TIMER":
    case "RESUME_TIMER":
    case "TAKE_BREAK_NOW":
    case "START_BREAK":
    case "GET_ACTIVITY_SNAPSHOT":
    case "SYNC_SITE_ACCESS":
      return true;
    case "UPDATE_SETTINGS":
      return isRecord(value.patch);
    case "DEFER_BREAK":
      return typeof value.minutes === "number" && value.minutes >= 1 && value.minutes <= 30;
    case "COMPLETE_BREAK":
      return (
        typeof value.elapsedSeconds === "number" &&
        Number.isFinite(value.elapsedSeconds) &&
        value.elapsedSeconds >= 0 &&
        value.elapsedSeconds <= 300
      );
    case "ACTIVITY_UPDATE":
      return isActivitySnapshot(value.snapshot);
    default:
      return false;
  }
}

export function sendRequest(message: ExtensionRequest): Promise<BackgroundResponse> {
  return chrome.runtime.sendMessage(message) as Promise<BackgroundResponse>;
}
