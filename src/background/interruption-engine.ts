/**
 * interruption-engine.ts
 *
 * The final arbiter of whether a break should be presented.
 *
 * Takes pre-computed verdicts from PresenceDetector and ContextDetector
 * and the raw ActivitySnapshot for fine-grained activity scoring.
 * Produces an InterruptionDecision that the controller acts on.
 *
 * Wall-clock elapsed time alone does NOT reach this function — the
 * ExposureTracker and PresenceDetector gate that before this is called.
 */

import type {
  ActivitySnapshot,
  ContextVerdict,
  InterruptionDecision,
  PresenceVerdict,
  Sensitivity,
} from "../shared/types";
import { MAX_DEFERRAL_MS, PAUSE_CONFIRMATION_MS } from "../shared/heuristics";


const THRESHOLDS: Record<Sensitivity, { medium: number; high: number }> = {
  low:      { medium: 38, high: 76 },
  balanced: { medium: 27, high: 62 },
  high:     { medium: 18, high: 50 },
};

export interface InterruptionInput {
  presence: PresenceVerdict;
  context: ContextVerdict;
  snapshot: ActivitySnapshot | null;
  sensitivity: Sensitivity;
  maxDeferralStartedAt?: number | null;
  returnGraceExpirationAt?: number | null;
}


/**
 * Assess whether a break should be presented now, deferred, or skipped.
 *
 * Call this only after ExposureTracker confirms the break is due and
 * PresenceDetector/ContextDetector verdicts have been produced.
 */
export function assessInterruption(
  input: InterruptionInput,
  now = Date.now(),
): InterruptionDecision {
  const { presence, context, snapshot, sensitivity } = input;

  // --- Presence gates ---
  if (presence === "long_absence") {
    return {
      action: "session_reset",
      reason: "Long absence detected; resetting session",
      nextEvaluationMs: 0,
    };
  }

  if (presence === "absent") {
    return {
      action: "defer_absence",
      reason: "User absent; deferring break",
      nextEvaluationMs: 60_000,
    };
  }

  // --- Returning grace gate ---
  if (input.returnGraceExpirationAt !== undefined && input.returnGraceExpirationAt !== null && now < input.returnGraceExpirationAt) {
    return {
      action: "wait_for_context",
      reason: "Returning from absence; granting grace period",
      nextEvaluationMs: Math.max(1_000, input.returnGraceExpirationAt - now),
    };
  }

  // --- Context gates ---
  if (context === "blocked") {
    // Timer is paused — should not reach here, but handle defensively.
    return {
      action: "continue",
      reason: "Timer is paused",
      nextEvaluationMs: 0,
    };
  }

  if (context === "busy") {
    return {
      action: "wait_for_context",
      reason: "High-priority context active (meeting / call / presentation)",
      nextEvaluationMs: 300_000,
    };
  }

  if (context === "focused") {
    return {
      action: "wait_for_context",
      reason: "Fullscreen active",
      nextEvaluationMs: 45_000,
    };
  }

  if (context === "media") {
    return {
      action: "wait_for_context",
      reason: "Media is playing",
      nextEvaluationMs: 30_000,
    };
  }

  // context === "limited" (restricted page) or "clear"
  if (context === "limited" && presence === "unknown") {
    // Cannot confirm presence on a restricted page. Apply conservative wait.
    return {
      action: "wait_for_context",
      reason: "Limited page access; waiting for a supported page",
      nextEvaluationMs: 60_000,
    };
  }

  // --- Activity scoring (only reached when context is clear or limited+present) ---
  if (!snapshot) {
    // No snapshot available but presence is present/unknown on a clear page.
    // Treat as low-risk: show the break.
    return {
      action: "show_break",
      reason: "No active interaction signal; low risk",
      nextEvaluationMs: 0,
      score: 0,
    };
  }

  const { score, risk, reasons, nextEvaluationMs } = scoreActivity(snapshot, sensitivity, now);

  const maxDeferralReached =
    input.maxDeferralStartedAt !== undefined &&
    input.maxDeferralStartedAt !== null &&
    (now - input.maxDeferralStartedAt >= MAX_DEFERRAL_MS);

  if (risk === "low") {
    // Check pause confirmation window
    const interactionAge = Math.max(0, now - snapshot.lastInteractionAt);
    if (interactionAge < PAUSE_CONFIRMATION_MS && !maxDeferralReached) {
      return {
        action: "wait_for_pause",
        reason: "Waiting to confirm natural pause",
        nextEvaluationMs: Math.max(2_000, PAUSE_CONFIRMATION_MS - interactionAge),
        score,
      };
    }

    return {
      action: "show_break",
      reason: reasons.join("; "),
      nextEvaluationMs: 0,
      score,
    };
  }

  // If activity risk is high but we've waited too long, force the break
  if (maxDeferralReached) {
    return {
      action: "show_break",
      reason: "Maximum deferral limit reached; forcing break",
      nextEvaluationMs: 0,
      score,
    };
  }

  return {
    action: "wait_for_pause",
    reason: reasons.join("; "),
    nextEvaluationMs,
    score,
  };
}

// ---------------------------------------------------------------------------
// Private — activity scoring (unchanged logic from previous engine)
// ---------------------------------------------------------------------------

interface ScoreResult {
  score: number;
  risk: "low" | "medium" | "high";
  reasons: string[];
  nextEvaluationMs: number;
}

function scoreActivity(
  snapshot: ActivitySnapshot,
  sensitivity: Sensitivity,
  now: number,
): ScoreResult {
  // High-priority sites are handled by ContextDetector before reaching here,
  // but guard defensively in case the snapshot still carries the flag.
  if (snapshot.isHighPrioritySite || snapshot.workType === "meeting") {
    return {
      score: 100,
      risk: "high",
      reasons: ["High-priority site active (Meeting / Video Call / Presentation)"],
      nextEvaluationMs: 300_000,
    };
  }

  let score = 0;
  const reasons: string[] = [];

  const keyboardAge    = Math.max(0, now - snapshot.lastKeyboardAt);
  const interactionAge = Math.max(0, now - snapshot.lastInteractionAt);
  const pageAge        = Math.max(0, now - snapshot.pageLoadedAt);
  const clickAge       = Math.max(0, now - snapshot.lastClickAt);
  const scrollAge      = Math.max(0, now - snapshot.lastScrollAt);

  if (snapshot.fullscreen) { score += 72; reasons.push("Fullscreen is active"); }
  if (snapshot.mediaPlaying) { score += 58; reasons.push("Media is playing"); }
  if (!snapshot.pageVisible) { score -= 32; reasons.push("Page is not visible"); }
  if (!snapshot.windowFocused) { score -= 24; reasons.push("Window is not focused"); }

  if (pageAge <= 5_000) { score += 16; reasons.push("Page just changed"); }

  if (keyboardAge <= 4_000) {
    score += 36; reasons.push("Typing just now");
  } else if (keyboardAge <= 10_000) {
    score += 23; reasons.push("Recent typing");
  } else if (keyboardAge <= 20_000) {
    score += 10;
  }

  if (snapshot.keyboardEventsIn30Seconds >= 10) {
    score += 30; reasons.push("Sustained typing");
  } else if (snapshot.keyboardEventsIn30Seconds >= 4) {
    score += 16;
  }

  if (interactionAge <= 2_000) {
    score += 20; reasons.push("Active interaction");
  } else if (interactionAge <= 7_000) {
    score += 13;
  } else if (interactionAge >= PAUSE_CONFIRMATION_MS && !snapshot.mediaPlaying && !snapshot.fullscreen) {
    score -= 38; reasons.push("Natural pause detected");
  }

  if (snapshot.interactionsIn30Seconds >= 15) {
    score += 24; reasons.push("High interaction pace");
  } else if (snapshot.interactionsIn30Seconds >= 6) {
    score += 12;
  }

  if (clickAge <= 3_000) score += 7;
  if (scrollAge <= 3_000) score += 6;

  score = Math.max(0, Math.min(100, score));
  const threshold = THRESHOLDS[sensitivity];
  const risk = score >= threshold.high ? "high" : score >= threshold.medium ? "medium" : "low";

  return {
    score,
    risk,
    reasons: reasons.length > 0 ? reasons : ["Quiet moment"],
    nextEvaluationMs: risk === "high" ? 45_000 : 30_000,
  };
}

// ---------------------------------------------------------------------------
// Legacy export — kept for backward compatibility with tests that use the
// old InterruptionAssessment interface. New callers should use assessInterruption.
// ---------------------------------------------------------------------------

/** @deprecated Use assessInterruption with InterruptionInput instead. */
export function assessInterruptionLegacy(
  snapshot: ActivitySnapshot | null,
  sensitivity: Sensitivity,
  now = Date.now(),
) {
  if (!snapshot) {
    return {
      score: 0,
      risk: "low" as const,
      reasons: ["No active interaction signal"],
      nextEvaluationMs: 30_000,
    };
  }
  return scoreActivity(snapshot, sensitivity, now);
}
