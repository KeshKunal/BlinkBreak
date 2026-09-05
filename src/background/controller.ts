/**
 * controller.ts
 *
 * Serialises extension events, persists state transitions, schedules alarms,
 * and coordinates tabs.
 *
 * The four-concept model is orchestrated in evaluateDueBreak():
 *   1. ExposureTracker  — has enough meaningful screen time accumulated?
 *   2. PresenceDetector — is the user actually present?
 *   3. ContextDetector  — is the current moment contextually appropriate?
 *   4. InterruptionEngine — what should we do right now?
 *
 * Content scripts are supplementary. Every code path handles a missing
 * content script gracefully. The timer never depends on script availability.
 */

import {
  isExtensionRequest,
  type BackgroundResponse,
  type ExtensionRequest,
} from "../shared/messages";
import { createDefaultTimer } from "../shared/defaults";
import {
  loadAppSnapshot,
  loadAppSnapshotForStartup,
  saveAppSnapshot,
  saveSettings,
  saveTimer,
} from "../shared/storage";
import type { ActivitySnapshot, AppSnapshot, TimerState } from "../shared/types";
import { sanitizeSettings } from "../shared/validation";
import { classifyUrl } from "../shared/page-access";
import { detectPresence } from "../shared/presence-detector";
import { detectContext } from "../shared/context-detector";
import { ContentBridge } from "./content-bridge";
import { DiagnosticsCollector } from "./diagnostics";
import { computeExposureUpdate, isExposureDue } from "./exposure-tracker";
import { assessInterruption } from "./interruption-engine";
import {
  completeBreakInSnapshot,
  recoverAppSnapshot,
  transitionTimer,
} from "./timer-engine";

const SCHEDULER_ALARM = "blinkbreak-scheduler";

export class BlinkBreakController {
  private content = new ContentBridge();
  private diagnostics = new DiagnosticsCollector();
  private operation = Promise.resolve();
  private initialized = false;

  register(): void {
    this.content.setDiagnostics(this.diagnostics);

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
      if (alarm.name === SCHEDULER_ALARM) {
        this.diagnostics.record({ timestamp: Date.now(), kind: "alarm_fired" });
        void this.enqueue(() => this.onAlarm());
      }
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
      void this.enqueue(() => this.onTabActivated(tabId));
    });

    // Handle in-tab navigation (SPA, reload, cross-origin, back/forward).
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      // Only act on full page commits, not every loading step.
      if (changeInfo.status !== "complete") return;
      void this.enqueue(() => this.onTabNavigated(tabId, tab.url));
    });

    chrome.windows.onFocusChanged.addListener(() => {
      void this.enqueue(() => this.syncActiveTab());
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      this.content.forgetTab(tabId);
      this.diagnostics.record({ timestamp: Date.now(), kind: "tab_closed", tabId });
    });

    chrome.permissions.onAdded.addListener(() =>
      void this.enqueue(() => this.content.syncRegistration()),
    );
    chrome.permissions.onRemoved.addListener(() =>
      void this.enqueue(() => this.content.syncRegistration()),
    );

    this.diagnostics.record({ timestamp: Date.now(), kind: "worker_started" });
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
    if (this.initialized) return;
    await this.content.syncRegistration();
    const now = Date.now();
    const startup = await loadAppSnapshotForStartup(now);
    const state = recoverAppSnapshot(startup.state, now);
    if (startup.needsPersistence || state !== startup.state) await saveAppSnapshot(state);
    this.diagnostics.noteTimer(state.timer);
    await this.syncRuntime(state);
    if (state.timer.status === "break_active") {
      await this.content.showOnActiveTab(state);
    }
    this.initialized = true;
  }

  private async handleRequest(
    message: ExtensionRequest,
    sender: chrome.runtime.MessageSender,
  ): Promise<BackgroundResponse> {
    switch (message.type) {
      case "GET_APP_STATE": {
        const state = await loadAppSnapshot();
        return { ok: true, state };
      }

      case "GET_DIAGNOSTICS": {
        return { ok: true, diagnostics: this.diagnostics.summarize() };
      }

      // CONTENT_HELLO — replaces CONTENT_READY with explicit handshake.
      // The content script sends this on load and retries with backoff if
      // the service worker is still starting. The response carries full sync state.
      case "CONTENT_HELLO": {
        if (sender.tab?.id === undefined) {
          return { ok: false, error: "Content context rejected" };
        }
        const tabId = sender.tab.id;
        const access = classifyUrl(sender.tab.url);
        this.content.noteReady(tabId, message.instanceId, access);
        this.diagnostics.record({
          timestamp: Date.now(),
          kind: "content_sync_sent",
          tabId,
          reason: `access=${access}`,
        });
        const state = await loadAppSnapshot();
        await this.content.showOnTab(tabId, state);
        const trackingEnabled = state.settings.smartInterruptionEnabled;
        const reportingEnabled =
          trackingEnabled && state.timer.status === "waiting_for_pause";
        return { ok: true, state, trackingEnabled, reportingEnabled };
      }

      case "ACTIVITY_UPDATE": {
        if (sender.tab?.id === undefined || sender.tab.active !== true) {
          return { ok: false, error: "Activity update rejected" };
        }
        const state = await loadAppSnapshot();
        if (state.timer.status === "waiting_for_pause") {
          const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
          const access = classifyUrl(activeTab?.url);
          const context = detectContext(
            message.snapshot,
            activeTab?.url,
            state.timer.status,
            access,
          );
          const presence = detectPresence(
            Date.now(),
            state.timer.exposureLastSampledAt,
            state.timer.lastPresenceConfirmedAt,
            message.snapshot,
          );
          const decision = assessInterruption({ 
            presence, 
            context, 
            snapshot: message.snapshot, 
            sensitivity: state.settings.sensitivity,
            maxDeferralStartedAt: state.timer.maxDeferralStartedAt,
            returnGraceExpirationAt: state.timer.returnGraceExpirationAt
          });
          this.diagnostics.recordDecision(decision);
          if (decision.action === "show_break") {
            await this.evaluateDueBreak(message.snapshot, state);
          }
        } else {
          await this.content.setPauseReportingOnTab(sender.tab.id, false);
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
        await this.content.broadcastTracking(state.settings.smartInterruptionEnabled);
        if (!state.settings.smartInterruptionEnabled && state.timer.status === "waiting_for_pause") {
          await this.evaluateDueBreak(null, state);
        } else {
          await this.syncRuntime(state);
        }
        return { ok: true, state };
      }

      case "SYNC_SITE_ACCESS": {
        await this.content.syncRegistration();
        const state = await loadAppSnapshot();
        return { ok: true, state };
      }

      case "START_SESSION": {
        const state = await loadAppSnapshot();
        state.timer = createDefaultTimer(Date.now(), state.settings);
        await saveTimer(state.timer);
        await this.content.hideOnActiveTab();
        await this.syncRuntime(state);
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
        state.timer = transitionTimer(state.timer, { type: "START_BREAK" }, state.settings);
        await saveAppSnapshot(state);
        await this.syncRuntime(state);
        await this.content.showOnActiveTab(state);
        return { ok: true, state };
      }

      case "START_BREAK": {
        const state = await loadAppSnapshot();
        state.timer = transitionTimer(state.timer, { type: "START_BREAK" }, state.settings);
        await saveAppSnapshot(state);
        await this.syncRuntime(state);
        await this.content.showOnActiveTab(state, sender.tab?.id === undefined);
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
          await this.content.hideOnActiveTab();
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
    if (hideSurface) await this.content.hideOnActiveTab();
    await this.syncRuntime(state);
    return { ok: true, state };
  }

  private async completeBreak(elapsedSeconds: number): Promise<BackgroundResponse> {
    const current = await loadAppSnapshot();
    if (current.timer.status !== "break_active") return { ok: true, state: current };
    const now = Date.now();
    const state = completeBreakInSnapshot(current, elapsedSeconds, now);
    this.diagnostics.record({ timestamp: now, kind: "break_completed" });
    await saveAppSnapshot(state);
    this.diagnostics.noteTimer(state.timer);
    await this.syncRuntime(state);
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

  /**
   * Core four-concept orchestration point.
   * Called on alarm, ACTIVITY_UPDATE (when waiting_for_pause), and navigation.
   */
  private async evaluateDueBreak(
    suppliedSnapshot?: ActivitySnapshot | null,
    suppliedState?: AppSnapshot,
  ): Promise<void> {
    const state = suppliedState ?? (await loadAppSnapshot());
    if (["paused", "break_active"].includes(state.timer.status)) return;

    const now = Date.now();

    // --- Step 1: Get snapshot and access class ---
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    const { snapshot, access } =
      suppliedSnapshot !== undefined
        ? { snapshot: suppliedSnapshot, access: classifyUrl(activeTab?.url) }
        : await this.content.getActiveSnapshot();

    // --- Step 2: Presence detection ---
    const presence = detectPresence(
      now,
      state.timer.exposureLastSampledAt,
      state.timer.lastPresenceConfirmedAt,
      snapshot,
    );
    this.diagnostics.notePresence(presence);

    // --- Step 3: Exposure update (advance or pause/reset the exposure counter) ---
    const exposureUpdate = computeExposureUpdate(state.timer, presence, now, state.settings);
    state.timer = transitionTimer(
      state.timer,
      { type: "EXPOSURE_UPDATE", update: exposureUpdate },
      state.settings,
      now,
    );

    if (exposureUpdate.action === "session_reset") {
      // Long absence — fresh session. No break.
      state.timer = transitionTimer(state.timer, { type: "SESSION_RESET" }, state.settings, now);
      this.diagnostics.record({ timestamp: now, kind: "long_absence_reset", reason: exposureUpdate.reason });
      await saveTimer(state.timer);
      this.diagnostics.noteTimer(state.timer);
      await this.syncRuntime(state);
      return;
    }

    if (exposureUpdate.action === "pause") {
      // Regular absence — push timer forward, no break.
      this.diagnostics.record({ timestamp: now, kind: "absence_detected", reason: exposureUpdate.reason });
      await saveTimer(state.timer);
      this.diagnostics.noteTimer(state.timer);
      await this.syncRuntime(state);
      return;
    }

    // --- Step 4: Check if exposure goal is met ---
    if (!isExposureDue(state.timer)) {
      // Not enough meaningful screen time yet — keep counting.
      await saveTimer(state.timer);
      this.diagnostics.noteTimer(state.timer);
      await this.syncRuntime(state);
      return;
    }

    // Exposure is due — transition to evaluating state.
    state.timer = transitionTimer(state.timer, { type: "DUE" }, state.settings, now);

    // --- Step 5: Context detection ---
    const context = detectContext(snapshot, activeTab?.url, state.timer.status, access);
    this.diagnostics.noteContext(context);
    this.diagnostics.setActiveTab(activeTab?.id);

    // --- Step 6: Interruption decision ---
    const decision = assessInterruption(
      { 
        presence, 
        context, 
        snapshot, 
        sensitivity: state.settings.sensitivity,
        maxDeferralStartedAt: state.timer.maxDeferralStartedAt,
        returnGraceExpirationAt: state.timer.returnGraceExpirationAt
      },
      now,
    );
    this.diagnostics.recordDecision(decision);

    switch (decision.action) {
      case "session_reset":
        state.timer = transitionTimer(state.timer, { type: "SESSION_RESET" }, state.settings, now);
        this.diagnostics.record({ timestamp: now, kind: "long_absence_reset" });
        break;

      case "defer_absence":
        // Push the timer forward; user is absent.
        state.timer = transitionTimer(
          state.timer,
          { type: "WAIT_FOR_PAUSE", delayMs: decision.nextEvaluationMs },
          state.settings,
          now,
        );
        this.diagnostics.record({ timestamp: now, kind: "absence_detected" });
        break;

      case "wait_for_context":
      case "wait_for_pause":
        state.timer = transitionTimer(
          state.timer,
          { type: "WAIT_FOR_PAUSE", delayMs: decision.nextEvaluationMs },
          state.settings,
          now,
        );
        await this.syncRuntime(state);
        if (decision.action === "wait_for_pause") {
          await this.content.setPauseReportingOnActiveTab(
            state.settings.smartInterruptionEnabled,
          );
        }
        await saveTimer(state.timer);
        this.diagnostics.noteTimer(state.timer);
        return;

      case "show_break":
        state.timer = transitionTimer(state.timer, { type: "START_BREAK" }, state.settings, now);
        await saveTimer(state.timer);
        this.diagnostics.noteTimer(state.timer);
        await this.syncRuntime(state);
        this.diagnostics.record({ timestamp: now, kind: "break_shown" });
        await this.content.showOnActiveTab(state, true);
        return;

      case "continue":
      default:
        break;
    }

    await saveTimer(state.timer);
    this.diagnostics.noteTimer(state.timer);
    await this.syncRuntime(state);
  }

  private async schedule(state: AppSnapshot): Promise<void> {
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
        break;
    }
    const existing = await chrome.alarms.get(SCHEDULER_ALARM);
    if (when !== null) {
      const scheduledTime = Math.max(Date.now() + 500, when);
      if (!existing || Math.abs(existing.scheduledTime - scheduledTime) > 250) {
        await chrome.alarms.create(SCHEDULER_ALARM, { when: scheduledTime });
      }
    } else if (existing) {
      await chrome.alarms.clear(SCHEDULER_ALARM);
    }
  }

  private async syncRuntime(state: AppSnapshot): Promise<void> {
    await Promise.all([
      this.schedule(state),
      this.updateAction(state.timer),
      this.content.setPauseReportingOnActiveTab(
        state.settings.smartInterruptionEnabled && state.timer.status === "waiting_for_pause",
      ),
    ]);
  }

  private async syncActiveTab(): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id !== undefined) await this.onTabActivated(tab.id);
  }

  private async onTabActivated(tabId: number): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await this.content.ensureOnTab(tabId, tab?.url);
    this.diagnostics.setActiveTab(tabId);
    const state = await loadAppSnapshot();
    await Promise.all([
      this.content.showOnTab(tabId, state),
      this.content.setPauseReportingOnTab(
        tabId,
        state.settings.smartInterruptionEnabled && state.timer.status === "waiting_for_pause",
      ),
    ]);
  }

  /**
   * Handle a tab completing navigation (SPA, reload, cross-origin, back/forward).
   * The content script's previous context is torn down by the browser; a fresh
   * CONTENT_HELLO handshake will arrive from the new page context.
   *
   * We only need to pre-inject if site access is granted and the new URL is injectable.
   */
  private async onTabNavigated(tabId: number, url?: string): Promise<void> {
    this.diagnostics.record({ timestamp: Date.now(), kind: "tab_navigated", tabId, url });

    // Forget the old script instance — a new CONTENT_HELLO will re-register it.
    // Do NOT call forgetTab() here because the tab still exists; just mark disconnected.
    const existing = this.content.getTabRecord(tabId);
    if (existing) existing.connected = false;

    // Attempt injection on the new URL (will skip if restricted).
    await this.content.ensureOnTab(tabId, url);

    const state = await loadAppSnapshot();
    await Promise.all([
      this.content.showOnTab(tabId, state),
      this.content.setPauseReportingOnTab(
        tabId,
        state.settings.smartInterruptionEnabled && state.timer.status === "waiting_for_pause",
      ),
    ]);
  }

  private async updateAction(timer: TimerState): Promise<void> {
    const labels: Partial<Record<TimerState["status"], string>> = {
      paused: "Paused",
      waiting_for_pause: "Waiting for a natural pause",
      break_active: "Break in progress",
    };
    const badge = timer.status === "paused" ? "II" : "";
    await Promise.all([
      chrome.action.setBadgeText({ text: badge }),
      chrome.action.setBadgeBackgroundColor({ color: "#7DB7D8" }),
      chrome.action.setTitle({ title: labels[timer.status] ?? "BlinkBreak" }),
    ]);
  }
}
