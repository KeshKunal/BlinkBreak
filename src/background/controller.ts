import {
  isActivitySnapshot,
  isExtensionRequest,
  type BackgroundResponse,
  type ContentCommand,
  type ExtensionRequest,
} from "../shared/messages";
import {
  loadAppSnapshot,
  saveAppSnapshot,
  saveSettings,
  saveStats,
  saveTimer,
} from "../shared/storage";
import type { ActivitySnapshot, AppSnapshot, TimerState } from "../shared/types";
import { sanitizeSettings } from "../shared/validation";
import { assessInterruption } from "./interruption-engine";
import { recoverTimer, transitionTimer } from "./timer-engine";

const SCHEDULER_ALARM = "blinkbreak-scheduler";
const CONTENT_SCRIPT_ID = "blinkbreak-content";
const ACTIVITY_FRESHNESS_MS = 90_000;

export class BlinkBreakController {
  private latestActivity = new Map<number, ActivitySnapshot>();
  private operation = Promise.resolve();

  register(): void {
    chrome.runtime.onInstalled.addListener((details) => {
      void this.enqueue(async () => {
        await this.initialize();
        if (details.reason === "install") {
          await chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
        }
      });
    });

    chrome.runtime.onStartup.addListener(() => void this.enqueue(() => this.initialize()));
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === SCHEDULER_ALARM) void this.enqueue(() => this.onAlarm());
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!isExtensionRequest(message)) {
        sendResponse({ ok: false, error: "Unsupported request" } satisfies BackgroundResponse);
        return false;
      }
      void this.enqueue(() => this.handleRequest(message, sender))
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, error: "BlinkBreak could not complete that action" }));
      return true;
    });

    chrome.tabs.onActivated.addListener(({ tabId }) => {
      void this.enqueue(() => this.restoreSurfaceToTab(tabId));
    });

    chrome.windows.onFocusChanged.addListener(() => {
      void this.enqueue(() => this.restoreSurfaceToActiveTab());
    });

    chrome.permissions.onAdded.addListener(() =>
      void this.enqueue(() => this.syncContentRegistration(true)),
    );
    chrome.permissions.onRemoved.addListener(() => void this.enqueue(() => this.syncContentRegistration()));

    void this.enqueue(() => this.initialize());
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.operation.then(task, task);
    this.operation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async initialize(): Promise<void> {
    await this.syncContentRegistration();
    const state = await loadAppSnapshot();
    state.timer = recoverTimer(state.timer, state.settings);
    await saveAppSnapshot(state);
    await this.schedule(state);
    await this.updateAction(state.timer);
    if (["prompt_ready", "break_active"].includes(state.timer.status)) {
      await this.restoreSurfaceToActiveTab(state);
    }
  }

  private async handleRequest(
    message: ExtensionRequest,
    sender: chrome.runtime.MessageSender,
  ): Promise<BackgroundResponse> {
    switch (message.type) {
      case "GET_APP_STATE": {
        const state = await loadAppSnapshot();
        await saveStats(state.stats);
        return { ok: true, state };
      }

      case "ACTIVITY_UPDATE": {
        if (sender.tab?.id === undefined || !isActivitySnapshot(message.snapshot)) {
          return { ok: false, error: "Activity update rejected" };
        }
        this.latestActivity.set(sender.tab.id, message.snapshot);
        const state = await loadAppSnapshot();
        if (state.timer.status === "waiting_for_pause") {
          const assessment = assessInterruption(
            message.snapshot,
            state.settings.sensitivity,
          );
          if (assessment.risk === "low") await this.evaluateDueBreak(message.snapshot, state);
        } else if (["prompt_ready", "break_active"].includes(state.timer.status)) {
          await this.restoreSurfaceToTab(sender.tab.id, state);
        }
        return { ok: true };
      }

      case "UPDATE_SETTINGS": {
        const state = await loadAppSnapshot();
        const previousInterval = state.settings.breakIntervalMinutes;
        state.settings = sanitizeSettings({ ...state.settings, ...message.patch });
        if (state.settings.breakIntervalMinutes !== previousInterval) {
          state.timer = transitionTimer(
            state.timer,
            { type: "INTERVAL_CHANGED" },
            state.settings,
          );
        }
        await saveSettings(state.settings);
        await saveTimer(state.timer);
        await this.schedule(state);
        await this.broadcastTracking(state.settings.smartInterruptionEnabled);
        if (!state.settings.smartInterruptionEnabled && state.timer.status === "waiting_for_pause") {
          await this.evaluateDueBreak(null, state);
        }
        return { ok: true, state };
      }

      case "SYNC_SITE_ACCESS": {
        await this.syncContentRegistration(true);
        const state = await loadAppSnapshot();
        return { ok: true, state };
      }

      case "PAUSE_TIMER":
        return this.changeTimer((state) => {
          state.timer = transitionTimer(state.timer, { type: "PAUSE" }, state.settings);
        }, true);

      case "RESUME_TIMER":
        return this.changeTimer((state) => {
          const wasPaused = state.timer.status === "paused";
          state.timer = transitionTimer(state.timer, { type: "RESUME" }, state.settings);
          if (wasPaused) state.stats.focusSessions += 1;
        }, true);

      case "TAKE_BREAK_NOW": {
        const state = await loadAppSnapshot();
        if (state.timer.status === "paused") return { ok: true, state };
        state.timer = transitionTimer(state.timer, { type: "DUE" }, state.settings);
        state.timer = transitionTimer(state.timer, { type: "PROMPT" }, state.settings);
        await saveTimer(state.timer);
        await this.schedule(state);
        await this.updateAction(state.timer);
        await this.restoreSurfaceToActiveTab(state);
        return { ok: true, state };
      }

      case "START_BREAK": {
        const state = await loadAppSnapshot();
        state.timer = transitionTimer(state.timer, { type: "START_BREAK" }, state.settings);
        await saveAppSnapshot(state);
        await this.schedule(state);
        await this.updateAction(state.timer);
        await this.restoreSurfaceToActiveTab(state, sender.tab?.id === undefined);
        return { ok: true, state };
      }

      case "DEFER_BREAK":
        return this.changeTimer(async (state) => {
          state.timer = transitionTimer(
            state.timer,
            { type: "DEFER", minutes: message.minutes },
            state.settings,
          );
          state.stats.deferred += 1;
          await this.hideActiveSurface();
        });

      case "COMPLETE_BREAK":
        return this.completeBreak(message.elapsedSeconds);

      case "GET_ACTIVITY_SNAPSHOT":
        return { ok: false, error: "Activity snapshots are provided by page contexts" };
    }
  }

  private async changeTimer(
    mutation: (state: AppSnapshot) => void | Promise<void>,
    hideSurface = false,
  ): Promise<BackgroundResponse> {
    const state = await loadAppSnapshot();
    await mutation(state);
    await saveAppSnapshot(state);
    if (hideSurface) await this.hideActiveSurface();
    await this.schedule(state);
    await this.updateAction(state.timer);
    return { ok: true, state };
  }

  private async completeBreak(elapsedSeconds: number): Promise<BackgroundResponse> {
    const state = await loadAppSnapshot();
    if (state.timer.status !== "break_active") return { ok: true, state };
    const now = Date.now();
    const uninterruptedMs = Math.max(0, now - state.timer.sessionStartedAt);
    state.timer = transitionTimer(state.timer, { type: "COMPLETE" }, state.settings, now);
    state.stats.completed += 1;
    state.stats.totalBreakSeconds += Math.min(
      state.settings.breakDurationSeconds,
      Math.max(0, elapsedSeconds),
    );
    state.stats.totalCompletedIntervalMs += uninterruptedMs;
    state.stats.longestUninterruptedMs = Math.max(
      state.stats.longestUninterruptedMs,
      uninterruptedMs,
    );
    state.stats.focusSessions += 1;
    await saveAppSnapshot(state);
    await this.schedule(state);
    await this.updateAction(state.timer);
    return { ok: true, state };
  }

  private async onAlarm(): Promise<void> {
    const state = await loadAppSnapshot();
    if (state.timer.status === "paused") return;

    if (state.timer.status === "break_active") {
      const startedAt = state.timer.activeBreakStartedAt ?? Date.now();
      const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
      await this.completeBreak(elapsed);
      return;
    }

    await this.evaluateDueBreak(undefined, state);
  }

  private async evaluateDueBreak(
    suppliedSnapshot?: ActivitySnapshot | null,
    suppliedState?: AppSnapshot,
  ): Promise<void> {
    const state = suppliedState ?? (await loadAppSnapshot());
    if (["paused", "prompt_ready", "break_active"].includes(state.timer.status)) return;
    const now = Date.now();
    if (["counting", "deferred"].includes(state.timer.status) && state.timer.nextBreakDueAt > now) {
      await this.schedule(state);
      return;
    }

    state.timer = transitionTimer(state.timer, { type: "DUE" }, state.settings, now);
    const snapshot =
      suppliedSnapshot === undefined ? await this.getActiveSnapshot() : suppliedSnapshot;
    const assessment = assessInterruption(snapshot, state.settings.sensitivity, now);

    if (!state.settings.smartInterruptionEnabled || assessment.risk === "low") {
      state.timer = transitionTimer(state.timer, { type: "PROMPT" }, state.settings, now);
      await saveTimer(state.timer);
      await this.schedule(state);
      await this.updateAction(state.timer);
      await this.restoreSurfaceToActiveTab(state);
      return;
    }

    state.timer = transitionTimer(
      state.timer,
      { type: "WAIT_FOR_PAUSE", delayMs: assessment.nextEvaluationMs },
      state.settings,
      now,
    );
    await saveTimer(state.timer);
    await this.schedule(state);
    await this.updateAction(state.timer);
  }

  private async getActiveSnapshot(): Promise<ActivitySnapshot | null> {
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

  private async schedule(state: AppSnapshot): Promise<void> {
    await chrome.alarms.clear(SCHEDULER_ALARM);
    let when: number | null = null;
    switch (state.timer.status) {
      case "counting":
      case "deferred":
        when = state.timer.nextBreakDueAt;
        break;
      case "break_due":
      case "evaluating":
        when = Date.now() + 1_000;
        break;
      case "waiting_for_pause":
        when = state.timer.nextEvaluationAt ?? Date.now() + 30_000;
        break;
      case "break_active":
        when =
          (state.timer.activeBreakStartedAt ?? Date.now()) +
          state.settings.breakDurationSeconds * 1_000;
        break;
      case "paused":
      case "prompt_ready":
        break;
    }
    if (when !== null) {
      await chrome.alarms.create(SCHEDULER_ALARM, { when: Math.max(Date.now() + 500, when) });
    }
  }

  private async updateAction(timer: TimerState): Promise<void> {
    const labels: Partial<Record<TimerState["status"], string>> = {
      paused: "Paused",
      waiting_for_pause: "Waiting for a natural pause",
      prompt_ready: "A good moment for a break",
      break_active: "Break in progress",
    };
    const badge = timer.status === "prompt_ready" ? "1" : timer.status === "paused" ? "Ⅱ" : "";
    await Promise.all([
      chrome.action.setBadgeText({ text: badge }),
      chrome.action.setBadgeBackgroundColor({ color: "#1D6B5B" }),
      chrome.action.setTitle({ title: labels[timer.status] ?? "BlinkBreak" }),
    ]);
  }

  private async restoreSurfaceToActiveTab(state?: AppSnapshot, playSound = false): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id !== undefined) await this.restoreSurfaceToTab(tab.id, state, playSound);
  }

  private async restoreSurfaceToTab(
    tabId: number,
    state?: AppSnapshot,
    playSound = false,
  ): Promise<void> {
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

  private async hideActiveSurface(): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "HIDE_BREAK_UI" } satisfies ContentCommand);
    } catch {
      // No surface exists on restricted pages.
    }
  }

  private async syncContentRegistration(injectOpenTabs = false): Promise<void> {
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

  private async broadcastTracking(enabled: boolean): Promise<void> {
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
}
