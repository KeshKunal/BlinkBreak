/**
 * diagnostics.ts
 *
 * Lightweight in-memory diagnostic ring buffer for BlinkBreak internals.
 *
 * Diagnostics are developer-oriented. They are never shown to end users.
 * They can be retrieved via GET_DIAGNOSTICS for bug investigation or by
 * developers who inspect the extension's service worker in DevTools.
 *
 * The ring buffer holds at most RING_SIZE entries to bound memory use.
 */

import type {
  ContextVerdict,
  DiagnosticSummary,
  PageAccessibility,
  PresenceVerdict,
  TimerState,
  InterruptionDecision,
} from "../shared/types";

const RING_SIZE = 50;

export type DiagnosticKind =
  | "content_hello"
  | "content_sync_sent"
  | "content_reconnecting"
  | "injection_skipped"
  | "injection_error"
  | "tab_navigated"
  | "tab_closed"
  | "worker_started"
  | "alarm_fired"
  | "absence_detected"
  | "long_absence_reset"
  | "clock_anomaly"
  | "exposure_update"
  | "session_reset"
  | "break_shown"
  | "break_completed";

export interface DiagnosticEvent {
  timestamp: number;
  kind: DiagnosticKind;
  tabId?: number;
  url?: string;
  reason?: string;
}

interface TabRecord {
  instanceId: string;
  access: PageAccessibility;
  lastHeartbeatAt: number;
  connected: boolean;
}

export class DiagnosticsCollector {
  private ring: DiagnosticEvent[] = [];
  private decisionTrace: InterruptionDecision[] = [];
  private tabRecords = new Map<number, TabRecord>();
  private activeTabId: number | undefined;
  private lastPresenceVerdict: PresenceVerdict = "unknown";
  private lastContextVerdict: ContextVerdict | null = null;
  private timerRef: TimerState | null = null;
  private healthy = true;

  record(event: DiagnosticEvent): void {
    this.ring.push(event);
    if (this.ring.length > RING_SIZE) {
      this.ring.shift();
    }
  }

  recordDecision(decision: InterruptionDecision): void {
    this.decisionTrace.push(decision);
    if (this.decisionTrace.length > 10) {
      this.decisionTrace.shift();
    }
  }

  noteTabRecord(tabId: number, record: TabRecord): void {
    this.tabRecords.set(tabId, record);
  }

  forgetTab(tabId: number): void {
    this.tabRecords.delete(tabId);
  }

  setActiveTab(tabId: number | undefined): void {
    this.activeTabId = tabId;
  }

  notePresence(verdict: PresenceVerdict): void {
    this.lastPresenceVerdict = verdict;
  }

  noteContext(verdict: ContextVerdict): void {
    this.lastContextVerdict = verdict;
  }

  noteTimer(timer: TimerState): void {
    this.timerRef = timer;
  }

  noteHealthy(healthy: boolean): void {
    this.healthy = healthy;
  }

  dump(): DiagnosticEvent[] {
    return [...this.ring];
  }

  summarize(): DiagnosticSummary {
    const activeRecord = this.activeTabId !== undefined
      ? this.tabRecords.get(this.activeTabId)
      : undefined;

    const injectable = activeRecord?.access === "injectable";

    return {
      isCurrentPageInjectable: injectable,
      isContentScriptConnected: activeRecord?.connected === true,
      lastHeartbeatAt: activeRecord?.lastHeartbeatAt ?? null,
      unavailabilityReason: !injectable && activeRecord
        ? `Page access: ${activeRecord.access}`
        : !activeRecord
          ? "No active tab record"
          : null,
      presenceVerdict: this.lastPresenceVerdict,
      contextVerdict: this.lastContextVerdict,
      isBackgroundHealthy: this.healthy,
      exposureAccumulatedMs: this.timerRef?.exposureAccumulatedMs ?? 0,
      exposureGoalMs: this.timerRef?.exposureGoalMs ?? 0,
      decisionTrace: [...this.decisionTrace],
    };
  }
}
