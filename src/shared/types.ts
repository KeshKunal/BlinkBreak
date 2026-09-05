export type TimerStatus =
  | "counting"
  | "break_due"
  | "evaluating"
  | "waiting_for_pause"
  | "break_active"
  | "deferred"
  | "paused";

export type Sensitivity = "low" | "balanced" | "high";
export type ThemePreference = "system" | "light" | "dark";
export type AnimationPreference = "system" | "full" | "reduced";

export interface UserSettings {
  breakIntervalMinutes: number;
  breakDurationSeconds: number;
  smartInterruptionEnabled: boolean;
  sensitivity: Sensitivity;
  defaultDeferralMinutes: number;
  soundEnabled: boolean;
  animationPreference: AnimationPreference;
  theme: ThemePreference;
  dailyGoal: number;
  onboardingComplete: boolean;
}

export interface TimerState {
  status: TimerStatus;
  sessionStartedAt: number;
  lastBreakCompletedAt: number | null;
  /** Convenience scheduling field — derived from exposure accounting.
   *  The alarm scheduler uses this. Do not compare it to `now` alone
   *  to decide whether to show a break; use ExposureTracker + PresenceDetector. */
  nextBreakDueAt: number;
  breakDeferredUntil: number | null;
  nextEvaluationAt: number | null;
  activeBreakStartedAt: number | null;
  remainingWhenPausedMs: number | null;
  consecutiveDeferrals: number;
  lastTransitionAt: number;
  maxDeferralStartedAt: number | null;
  returnGraceExpirationAt: number | null;

  // --- Exposure tracking (presence-aware) ---
  /** Meaningful screen time accumulated toward the current break interval (ms). */
  exposureAccumulatedMs: number;
  /** Target exposure required to trigger a break (ms). Mirrors breakIntervalMinutes * 60_000. */
  exposureGoalMs: number;
  /** Timestamp of the last exposure accounting update. Used to detect absence gaps. */
  exposureLastSampledAt: number;

  // --- Presence tracking ---
  /** Last timestamp where the user's presence was positively confirmed. */
  lastPresenceConfirmedAt: number;
  /** Last known presence verdict, persisted for diagnostics. */
  presenceState: PresenceVerdict;
}

export interface DailyStats {
  date: string;
  completed: number;
  deferred: number;
  totalBreakSeconds: number;
  focusSessions: number;
  totalCompletedIntervalMs: number;
  longestUninterruptedMs: number;
}

export interface ActivitySnapshot {
  capturedAt: number;
  pageLoadedAt: number;
  lastInteractionAt: number;
  lastKeyboardAt: number;
  lastPointerAt: number;
  lastScrollAt: number;
  lastClickAt: number;
  interactionsIn30Seconds: number;
  keyboardEventsIn30Seconds: number;
  pageVisible: boolean;
  windowFocused: boolean;
  fullscreen: boolean;
  mediaPlaying: boolean;
  isHighPrioritySite?: boolean;
  workType?: "meeting" | "coding_flow" | "reading_browsing" | "idle";
}

export type InterruptionRisk = "low" | "medium" | "high";

export interface InterruptionAssessment {
  score: number;
  risk: InterruptionRisk;
  reasons: string[];
  nextEvaluationMs: number;
}

// ---------------------------------------------------------------------------
// Presence / Context verdicts
// ---------------------------------------------------------------------------

/** Whether the user is at the computer. */
export type PresenceVerdict =
  | "present"       // Interaction confirmed recently
  | "absent"        // No activity for > ABSENCE_THRESHOLD_MS
  | "long_absence"  // No activity for > LONG_ABSENCE_THRESHOLD_MS → session reset
  | "unknown";      // Cannot determine (no content script, cold start, restricted page)

/** Whether the current context is appropriate for a break interruption. */
export type ContextVerdict =
  | "clear"    // Normal; no contraindications
  | "busy"     // Meeting, call, live presentation
  | "focused"  // Fullscreen or intensive keyboard activity
  | "media"    // Unpaused media
  | "limited"  // Restricted page — content script unavailable
  | "blocked"; // Explicitly paused by user

/** Page injectability classification. */
export type PageAccessibility =
  | "injectable"         // Normal http / https
  | "restricted_scheme"  // chrome://, edge://, brave://, about:, data:, …
  | "extension_page"     // chrome-extension://
  | "pdf"                // Browser PDF viewer
  | "unknown";           // No URL available

// ---------------------------------------------------------------------------
// Interruption decision (replaces InterruptionAssessment as the output type)
// ---------------------------------------------------------------------------

export type InterruptionAction =
  | "show_break"        // Proceed to BREAK_ACTIVE
  | "wait_for_context"  // Context blocked; re-evaluate later
  | "wait_for_pause"    // User active; wait for natural pause
  | "defer_absence"     // User absent; push timer forward
  | "session_reset"     // Long absence; fresh session
  | "continue";         // Not yet due; keep counting

export interface InterruptionDecision {
  action: InterruptionAction;
  reason: string;
  nextEvaluationMs: number;
  score?: number;
}

export interface AppSnapshot {
  settings: UserSettings;
  timer: TimerState;
  stats: DailyStats;
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export interface DiagnosticSummary {
  isCurrentPageInjectable: boolean;
  isContentScriptConnected: boolean;
  lastHeartbeatAt: number | null;
  unavailabilityReason: string | null;
  presenceVerdict: PresenceVerdict;
  contextVerdict: ContextVerdict | null;
  isBackgroundHealthy: boolean;
  exposureAccumulatedMs: number;
  exposureGoalMs: number;
  decisionTrace: InterruptionDecision[];
}
