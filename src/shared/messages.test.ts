import { afterEach, describe, expect, it, vi } from "vitest";
import { hasExtensionContext, isExtensionRequest, sendRequest } from "./messages";

afterEach(() => vi.unstubAllGlobals());

describe("extension message validation", () => {
  it("accepts explicit known commands", () => {
    expect(isExtensionRequest({ type: "PAUSE_TIMER" })).toBe(true);
    expect(isExtensionRequest({ type: "SYNC_SITE_ACCESS" })).toBe(true);
    expect(isExtensionRequest({ type: "GET_POPUP_STATE" })).toBe(true);
    expect(isExtensionRequest({ type: "START_SESSION" })).toBe(true);
    expect(isExtensionRequest({ type: "CONTENT_READY" })).toBe(true);
    expect(isExtensionRequest({ type: "DEFER_BREAK", minutes: 5 })).toBe(true);
    expect(isExtensionRequest({ type: "COMPLETE_BREAK", elapsedSeconds: 20 })).toBe(true);
  });

  it("rejects arbitrary commands and invalid payloads", () => {
    expect(isExtensionRequest({ type: "DELETE_EVERYTHING" })).toBe(false);
    expect(isExtensionRequest({ type: "DEFER_BREAK", minutes: 999 })).toBe(false);
    expect(isExtensionRequest({ type: "COMPLETE_BREAK", elapsedSeconds: Number.NaN })).toBe(false);
  });

  it("turns synchronous invalidated-context errors into rejected promises", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        id: undefined,
        sendMessage: () => {
          throw new Error("Extension context invalidated");
        },
      },
    });

    expect(hasExtensionContext()).toBe(false);
    await expect(sendRequest({ type: "GET_APP_STATE" })).rejects.toThrow(
      "Extension context invalidated",
    );
  });
});
