import { describe, expect, it } from "vitest";
import { isExtensionRequest } from "./messages";

describe("extension message validation", () => {
  it("accepts explicit known commands", () => {
    expect(isExtensionRequest({ type: "PAUSE_TIMER" })).toBe(true);
    expect(isExtensionRequest({ type: "DEFER_BREAK", minutes: 5 })).toBe(true);
    expect(isExtensionRequest({ type: "COMPLETE_BREAK", elapsedSeconds: 20 })).toBe(true);
  });

  it("rejects arbitrary commands and invalid payloads", () => {
    expect(isExtensionRequest({ type: "DELETE_EVERYTHING" })).toBe(false);
    expect(isExtensionRequest({ type: "DEFER_BREAK", minutes: 999 })).toBe(false);
    expect(isExtensionRequest({ type: "COMPLETE_BREAK", elapsedSeconds: Number.NaN })).toBe(false);
  });
});
