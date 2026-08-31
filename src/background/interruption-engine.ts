import type {
  ActivitySnapshot,
  InterruptionAssessment,
  Sensitivity,
} from "../shared/types";

const THRESHOLDS: Record<Sensitivity, { medium: number; high: number }> = {
  low: { medium: 38, high: 76 },
  balanced: { medium: 27, high: 62 },
  high: { medium: 18, high: 50 },
};

export function assessInterruption(
  snapshot: ActivitySnapshot | null,
  sensitivity: Sensitivity,
  now = Date.now(),
): InterruptionAssessment {
  if (!snapshot) {
    return {
      score: 0,
      risk: "low",
      reasons: ["No active interaction signal"],
      nextEvaluationMs: 30_000,
    };
  }

  let score = 0;
  const reasons: string[] = [];
  const keyboardAge = Math.max(0, now - snapshot.lastKeyboardAt);
  const interactionAge = Math.max(0, now - snapshot.lastInteractionAt);
  const clickAge = Math.max(0, now - snapshot.lastClickAt);
  const scrollAge = Math.max(0, now - snapshot.lastScrollAt);

  if (snapshot.fullscreen) {
    score += 72;
    reasons.push("Fullscreen is active");
  }
  if (snapshot.mediaPlaying) {
    score += 58;
    reasons.push("Media is playing");
  }
  if (!snapshot.pageVisible) {
    score -= 32;
    reasons.push("Page is not visible");
  }
  if (!snapshot.windowFocused) {
    score -= 24;
    reasons.push("Window is not focused");
  }

  if (keyboardAge <= 4_000) {
    score += 36;
    reasons.push("Typing just now");
  } else if (keyboardAge <= 10_000) {
    score += 23;
    reasons.push("Recent typing");
  } else if (keyboardAge <= 20_000) {
    score += 10;
  }

  if (snapshot.keyboardEventsIn30Seconds >= 10) {
    score += 30;
    reasons.push("Sustained typing");
  } else if (snapshot.keyboardEventsIn30Seconds >= 4) {
    score += 16;
  }

  if (interactionAge <= 2_000) {
    score += 20;
    reasons.push("Active interaction");
  } else if (interactionAge <= 7_000) {
    score += 13;
  } else if (interactionAge >= 15_000) {
    score -= 38;
    reasons.push("Natural pause detected");
  }

  if (snapshot.interactionsIn30Seconds >= 15) {
    score += 24;
    reasons.push("High interaction pace");
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
