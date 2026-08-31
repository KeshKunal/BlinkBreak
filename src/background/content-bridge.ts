import { isActivitySnapshot, type ContentCommand } from "../shared/messages";
import { loadAppSnapshot } from "../shared/storage";
import type { ActivitySnapshot, AppSnapshot } from "../shared/types";

const CONTENT_SCRIPT_ID = "blinkbreak-content";
const ACTIVITY_FRESHNESS_MS = 90_000;

export class ContentBridge {
  private latestActivity = new Map<number, ActivitySnapshot>();

  rememberActivity(tabId: number, snapshot: ActivitySnapshot): void {
    this.latestActivity.set(tabId, snapshot);
  }

  async getActiveSnapshot(): Promise<ActivitySnapshot | null> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) return null;

    try {
      const response = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: "GET_ACTIVITY_SNAPSHOT" }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_200)),
      ]);
      if (isActivitySnapshot(response)) {
        this.latestActivity.set(tab.id, response);
        return response;
      }
    } catch {
      // Restricted pages cannot host content scripts; use any fresh in-memory signal.
    }

    const cached = this.latestActivity.get(tab.id);
    return cached && Date.now() - cached.capturedAt <= ACTIVITY_FRESHNESS_MS ? cached : null;
  }

  async showOnActiveTab(state?: AppSnapshot, playSound = false): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id !== undefined) await this.showOnTab(tab.id, state, playSound);
  }

  async showOnTab(tabId: number, state?: AppSnapshot, playSound = false): Promise<void> {
    const current = state ?? (await loadAppSnapshot());
    let command: ContentCommand | null = null;
    if (current.timer.status === "prompt_ready") {
      command = { type: "SHOW_BREAK_PROMPT", state: current };
    } else if (current.timer.status === "break_active") {
      command = { type: "SHOW_ACTIVE_BREAK", state: current, playSound };
    }
    if (!command) return;
    try {
      await chrome.tabs.sendMessage(tabId, command);
    } catch {
      // Browser-owned and extension-store pages intentionally reject content scripts.
    }
  }

  async hideOnActiveTab(): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "HIDE_BREAK_UI" } satisfies ContentCommand);
    } catch {
      // No surface exists on restricted pages.
    }
  }

  async syncRegistration(injectOpenTabs = false): Promise<void> {
    const hasAccess = await chrome.permissions.contains({
      permissions: ["scripting"],
      origins: ["http://*/*", "https://*/*"],
    });
    const registered = await chrome.scripting
      ?.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] })
      .catch(() => []);
    const exists = Boolean(registered?.length);

    if (hasAccess && !exists) {
      await chrome.scripting.registerContentScripts([
        {
          id: CONTENT_SCRIPT_ID,
          matches: ["http://*/*", "https://*/*"],
          js: ["content.js"],
          runAt: "document_start",
          persistAcrossSessions: true,
        },
      ]);
    } else if (!hasAccess && exists) {
      await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    }

    if (hasAccess && (injectOpenTabs || !exists)) await this.injectIntoOpenTabs();
  }

  async broadcastTracking(enabled: boolean): Promise<void> {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map(async (tab) => {
        if (tab.id === undefined) return;
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: "SET_ACTIVITY_TRACKING",
            enabled,
          } satisfies ContentCommand);
        } catch {
          // The tab either lacks optional site access or has not loaded the script yet.
        }
      }),
    );
  }

  private async injectIntoOpenTabs(): Promise<void> {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map(async (tab) => {
        if (tab.id === undefined) return;
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"],
          });
        } catch {
          // Browser-owned, file, and extension-store pages correctly reject injection.
        }
      }),
    );
  }
}
