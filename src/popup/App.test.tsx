/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultStats, createDefaultTimer, DEFAULT_SETTINGS } from "../shared/defaults";
import { sendRequest } from "../shared/messages";
import type { AppSnapshot } from "../shared/types";
import { App } from "./App";

vi.mock("../shared/messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/messages")>();
  return { ...actual, sendRequest: vi.fn() };
});

const now = Date.now();
const mockedSendRequest = vi.mocked(sendRequest);
let root: Root | null = null;

function snapshot(status: "counting" | "break_active"): AppSnapshot {
  return {
    settings: { ...DEFAULT_SETTINGS, animationPreference: "reduced" },
    timer: {
      ...createDefaultTimer(now, DEFAULT_SETTINGS),
      status,
      activeBreakStartedAt: status === "break_active" ? now : null,
    },
    stats: createDefaultStats(new Date(now)),
  };
}

async function renderPopup(): Promise<void> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<App />));
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  mockedSendRequest.mockReset();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
  vi.stubGlobal("chrome", {
    storage: {
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime: { openOptionsPage: vi.fn() },
  });
  vi.spyOn(window, "close").mockImplementation(() => undefined);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("popup break handoff", () => {
  it("closes the popup after the active page accepts the canonical break surface", async () => {
    mockedSendRequest.mockImplementation(async (message) =>
      message.type === "START_BREAK"
        ? { ok: true, state: snapshot("break_active"), pageBreakSurfaceShown: true }
        : { ok: true, state: snapshot("counting"), pageBreakSurfaceShown: false },
    );
    await renderPopup();

    const button = [...document.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Take a break now"),
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());

    expect(window.close).toHaveBeenCalledOnce();
    expect(document.querySelector(".popup-break")).toBeNull();
  });

  it("keeps one popup break screen when the active page is restricted", async () => {
    mockedSendRequest.mockImplementation(async (message) =>
      message.type === "START_BREAK"
        ? { ok: true, state: snapshot("break_active"), pageBreakSurfaceShown: false }
        : { ok: true, state: snapshot("counting"), pageBreakSurfaceShown: false },
    );
    await renderPopup();

    const button = [...document.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Take a break now"),
    );
    await act(async () => button?.click());

    expect(window.close).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".popup-break")).toHaveLength(1);
  });
});
