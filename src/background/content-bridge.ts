/**
 * content-bridge.ts
 *
 * Manages optional content-script injection and messaging.
 *
 * Key design principles:
 *   - Classify the URL before attempting injection (no blind scripting.executeScript).
 *   - Never retry injection on permanently restricted pages.
 *   - Maintain a TabRecord per injected tab for diagnostics and lifecycle tracking.
 *   - Return access classification alongside snapshots so callers know WHY data is null.
 */

import { isActivitySnapshot, type ContentCommand } from "../shared/messages";
import { classifyUrl, isInjectable } from "../shared/page-access";
import { SITE_ACCESS } from "../shared/site-access";
import { loadAppSnapshot } from "../shared/storage";
import type { ActivitySnapshot, AppSnapshot, PageAccessibility } from "../shared/types";
import type { DiagnosticsCollector } from "./diagnostics";

const CONTENT_SCRIPT_ID = "blinkbreak-content";

export interface TabRecord {
  instanceId: string;
  access: PageAccessibility;
  lastHeartbeatAt: number;
  connected: boolean;
}

export interface SnapshotResult {
  snapshot: ActivitySnapshot | null;
  access: PageAccessibility;
}

export class ContentBridge {
  private knownTabs = new Map<number, TabRecord>();
  private hasSiteAccess = false;
  private diagnostics: DiagnosticsCollector | null = null;

  setDiagnostics(d: DiagnosticsCollector): void {
    this.diagnostics = d;
  }

  noteReady(tabId: number, instanceId: string, access: PageAccessibility): void {
    const record: TabRecord = {
      instanceId,
      access,
      lastHeartbeatAt: Date.now(),
      connected: true,
    };
    this.knownTabs.set(tabId, record);
    this.diagnostics?.noteTabRecord(tabId, record);
    this.diagnostics?.record({
      timestamp: Date.now(),
      kind: "content_hello",
      tabId,
      reason: `instance=${instanceId} access=${access}`,
    });
  }

  forgetTab(tabId: number): void {
    this.knownTabs.delete(tabId);
    this.diagnostics?.forgetTab(tabId);
    this.diagnostics?.record({ timestamp: Date.now(), kind: "tab_closed", tabId });
  }

  getTabRecord(tabId: number): TabRecord | undefined {
    return this.knownTabs.get(tabId);
  }

  /**
   * Get the activity snapshot from the active tab, along with its access class.
   * Callers should check `access` to understand WHY `snapshot` may be null.
   */
  async getActiveSnapshot(): Promise<SnapshotResult> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) return { snapshot: null, access: "unknown" };

    const access = classifyUrl(tab.url);
    if (!isInjectable(tab.url)) {
      return { snapshot: null, access };
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: "GET_ACTIVITY_SNAPSHOT" }),
        new Promise<null>((resolve) => {
          timeoutId = setTimeout(() => resolve(null), 1_200);
        }),
      ]);
      if (isActivitySnapshot(response)) return { snapshot: response, access };
    } catch {
      // Content script not yet ready on this tab.
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }

    return { snapshot: null, access };
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
      tab = tabs.find((t) => t.url && isInjectable(t.url));
    }
    if (tab?.id !== undefined) {
      await this.ensureOnTab(tab.id, tab.url);
      await this.showOnTab(tab.id, state, playSound);
    }
  }

  async showOnTab(tabId: number, state?: AppSnapshot, playSound = false): Promise<void> {
    const current = state ?? (await loadAppSnapshot());
    let command: ContentCommand = { type: "HIDE_BREAK_UI" };
    if (current.timer.status === "break_active") {
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
          // Restricted page or injection failed silently.
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
      // No surface on restricted page — expected.
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

  /**
   * Ensures the content script is present on a tab.
   * Classifies the URL first — skips injection entirely for restricted pages.
   */
  async ensureOnTab(tabId: number, url?: string | null): Promise<void> {
    if (!this.hasSiteAccess) return;

    const access = classifyUrl(url);
    if (!isInjectable(url)) {
      this.diagnostics?.record({
        timestamp: Date.now(),
        kind: "injection_skipped",
        tabId,
        reason: `access=${access}`,
      });
      return;
    }

    // Check if already connected.
    try {
      const response = await chrome.tabs.sendMessage(
        tabId,
        { type: "PING_CONTENT" } satisfies ContentCommand,
      );
      if (response?.ready === true) {
        const existing = this.knownTabs.get(tabId);
        if (existing) {
          existing.lastHeartbeatAt = Date.now();
          existing.connected = true;
        }
        return;
      }
    } catch {
      // Not yet connected — proceed to inject.
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
    } catch {
      this.diagnostics?.record({
        timestamp: Date.now(),
        kind: "injection_error",
        tabId,
        reason: `Injection failed (restricted or unavailable)`,
      });
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
            // Restricted tab or script not loaded.
          }
        }),
      );
    }
  }

  private async injectIntoActiveTab(): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id !== undefined) await this.ensureOnTab(tab.id, tab.url);
  }
}
