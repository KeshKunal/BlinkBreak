import {
  isExtensionRequest,
  type BackgroundResponse,
  type ExtensionRequest,
} from "../shared/messages";
import { createDefaultTimer } from "../shared/defaults";
import {
  loadAppSnapshot,
  saveAppSnapshot,
  saveSettings,
  saveStats,
  saveTimer,
} from "../shared/storage";
import type { ActivitySnapshot, AppSnapshot, TimerState } from "../shared/types";
import { sanitizeSettings } from "../shared/validation";
import { ContentBridge } from "./content-bridge";
import { assessInterruption } from "./interruption-engine";
import { recoverTimer, transitionTimer } from "./timer-engine";

const SCHEDULER_ALARM = "blinkbreak-scheduler";

export class BlinkBreakController {
  private content = new ContentBridge();
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
      void this.enqueue(() => this.content.showOnTab(tabId));
    });

    chrome.windows.onFocusChanged.addListener(() => {
      void this.enqueue(() => this.content.showOnActiveTab());
    });

    chrome.permissions.onAdded.addListener(() =>
      void this.enqueue(() => this.content.syncRegistration(true)),
    );
    chrome.permissions.onRemoved.addListener(() =>
      void this.enqueue(() => this.content.syncRegistration()),
    );

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
    await this.content.syncRegistration();
    const state = await loadAppSnapshot();
    state.timer = recoverTimer(state.timer, state.settings);
    await saveAppSnapshot(state);
    await this.schedule(state);
    await this.updateAction(state.timer);
    if (["prompt_ready", "break_active"].includes(state.timer.status)) {
      await this.content.showOnActiveTab(state);
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
        if (sender.tab?.id === undefined) {
          return { ok: false, error: "Activity update rejected" };
        }
        this.content.rememberActivity(sender.tab.id, message.snapshot);
        const state = await loadAppSnapshot();
        if (state.timer.status === "waiting_for_pause") {
          const assessment = assessInterruption(
            message.snapshot,
            state.settings.sensitivity,
          );
          if (assessment.risk === "low") await this.evaluateDueBreak(message.snapshot, state);
        } else if (["prompt_ready", "break_active"].includes(state.timer.status)) {
          await this.content.showOnTab(sender.tab.id, state);
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
        await this.content.broadcastTracking(state.settings.smartInterruptionEnabled);
        if (!state.settings.smartInterruptionEnabled && state.timer.status === "waiting_for_pause") {
          await this.evaluateDueBreak(null, state);
        }
        return { ok: true, state };
      }

      case "SYNC_SITE_ACCESS": {
        await this.content.syncRegistration(true);
        const state = await loadAppSnapshot();
        return { ok: true, state };
      }

      case "START_SESSION": {
        const state = await loadAppSnapshot();
        state.timer = createDefaultTimer(Date.now(), state.settings);
        await saveTimer(state.timer);
        await this.content.hideOnActiveTab();
        await this.schedule(state);
        await this.updateAction(state.timer);
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
        await this.content.showOnActiveTab(state);
        return { ok: true, state };
      }

      case "START_BREAK": {
        const state = await loadAppSnapshot();
        state.timer = transitionTimer(state.timer, { type: "START_BREAK" }, state.settings);
        await saveAppSnapshot(state);
        await this.schedule(state);
        await this.updateAction(state.timer);
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
      suppliedSnapshot === undefined ? await this.content.getActiveSnapshot() : suppliedSnapshot;
    const assessment = assessInterruption(snapshot, state.settings.sensitivity, now);

    if (!state.settings.smartInterruptionEnabled || assessment.risk === "low") {
      state.timer = transitionTimer(state.timer, { type: "PROMPT" }, state.settings, now);
      await saveTimer(state.timer);
      await this.schedule(state);
      await this.updateAction(state.timer);
      await this.content.showOnActiveTab(state);
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
    const badge = timer.status === "prompt_ready" ? "1" : timer.status === "paused" ? "II" : "";
    await Promise.all([
      chrome.action.setBadgeText({ text: badge }),
      chrome.action.setBadgeBackgroundColor({ color: "#1D6B5B" }),
      chrome.action.setTitle({ title: labels[timer.status] ?? "BlinkBreak" }),
    ]);
  }

}
