import { isActivitySnapshot, type ContentCommand } from "../shared/messages";
import { SITE_ACCESS } from "../shared/site-access";
import { loadAppSnapshot } from "../shared/storage";
import type { ActivitySnapshot, AppSnapshot } from "../shared/types";

const CONTENT_SCRIPT_ID = "blinkbreak-content";

export class ContentBridge {
  private knownTabs = new Set<number>();
  private hasSiteAccess = false;

  noteReady(tabId: number): void {
    this.knownTabs.add(tabId);
  }

  forgetTab(tabId: number): void {
    this.knownTabs.delete(tabId);
  }

  async getActiveSnapshot(): Promise<ActivitySnapshot | null> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) return null;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: "GET_ACTIVITY_SNAPSHOT" }),
        new Promise<null>((resolve) => {
          timeoutId = setTimeout(() => resolve(null), 1_200);
        }),
      ]);
      if (isActivitySnapshot(response)) return response;
    } catch {
      // Restricted pages cannot host content scripts; use any fresh in-memory signal.
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }

    return null;
  }

  async showOnActiveTab(state?: AppSnapshot, playSound = false): Promise<void> {
    let tab: chrome.tabs.Tab | undefined = (
      await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    )[0];
    if (tab?.id === undefined) {
      tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    }
    if (tab?.id === undefined) {
      const tabs = await chrome.tabs.query({ active: true });
      tab = tabs.find((t) => t.url && !t.url.startsWith("chrome-extension://"));
    }
    if (tab?.id !== undefined) {
      await this.ensureOnTab(tab.id);
      await this.showOnTab(tab.id, state, playSound);
    }
  }

  async showOnTab(tabId: number, state?: AppSnapshot, playSound = false): Promise<void> {
    const current = state ?? (await loadAppSnapshot());
    let command: ContentCommand = { type: "HIDE_BREAK_UI" };
    if (current.timer.status === "prompt_ready") {
      command = { type: "SHOW_BREAK_PROMPT", state: current };
    } else if (current.timer.status === "break_active") {
      command = { type: "SHOW_ACTIVE_BREAK", state: current, playSound };
    }
    try {
      await chrome.tabs.sendMessage(tabId, command);
    } catch {
      if (this.hasSiteAccess) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ["content.js"],
          });
          await chrome.tabs.sendMessage(tabId, command);
        } catch {
          // Browser-owned or restricted page
        }
      }
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

  async setPauseReportingOnActiveTab(enabled: boolean): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id !== undefined) await this.setPauseReportingOnTab(tab.id, enabled);
  }

  async setPauseReportingOnTab(tabId: number, enabled: boolean): Promise<void> {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: "SET_PAUSE_REPORTING",
        enabled,
      } satisfies ContentCommand);
    } catch {
      // Tab may be restricted or content script not ready.
    }
  }

  async ensureOnTab(tabId: number): Promise<void> {
    if (!this.hasSiteAccess) return;
    try {
      const response = await chrome.tabs.sendMessage(
        tabId,
        { type: "PING_CONTENT" } satisfies ContentCommand,
      );
      if (response?.ready === true) {
        this.knownTabs.add(tabId);
        return;
      }
    } catch {
      // Context not ready
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      this.knownTabs.add(tabId);
    } catch {
      // Restricted page
    }
  }

  async syncRegistration(): Promise<void> {
    const hasAccess = await chrome.permissions.contains(SITE_ACCESS).catch(() => false);
    const registered = await chrome.scripting
      ?.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] })
      .catch(() => []);
    const exists = Boolean(registered?.length);
    this.hasSiteAccess = hasAccess;

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

    if (!hasAccess) {
      this.knownTabs.clear();
    } else {
      await this.injectIntoActiveTab();
    }
  }

  async broadcastTracking(enabled: boolean): Promise<void> {
    const tabs = await chrome.tabs.query({});
    const batchSize = 12;
    for (let index = 0; index < tabs.length; index += batchSize) {
      await Promise.all(
        tabs.slice(index, index + batchSize).map(async (tab) => {
          if (tab.id === undefined) return;
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: "SET_ACTIVITY_TRACKING",
              enabled,
            } satisfies ContentCommand);
          } catch {
            // Tab has not loaded the script yet or is restricted.
          }
        }),
      );
    }
  }

  private async injectIntoActiveTab(): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id !== undefined) await this.ensureOnTab(tab.id);
  }
}
