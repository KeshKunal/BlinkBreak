export type TimerStatus =
  | "counting"
  | "break_due"
  | "evaluating"
  | "waiting_for_pause"
  | "prompt_ready"
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
  nextBreakDueAt: number;
  breakDeferredUntil: number | null;
  nextEvaluationAt: number | null;
  activeBreakStartedAt: number | null;
  remainingWhenPausedMs: number | null;
  consecutiveDeferrals: number;
  lastTransitionAt: number;
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
}

export type InterruptionRisk = "low" | "medium" | "high";

export interface InterruptionAssessment {
  score: number;
  risk: InterruptionRisk;
  reasons: string[];
  nextEvaluationMs: number;
}

export interface AppSnapshot {
  settings: UserSettings;
  timer: TimerState;
  stats: DailyStats;
}
