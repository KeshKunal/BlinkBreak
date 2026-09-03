/**
 * context-detector.ts
 *
 * Pure function that classifies the current browsing context to determine
 * whether a break interruption would be appropriate.
 *
 * This separates "is the context appropriate?" from "is the user active?"
 * (PresenceDetector) and "has enough time elapsed?" (ExposureTracker).
 * The InterruptionEngine combines all three.
 *
 * Verdict priority (highest first):
 *   blocked  → user explicitly paused BlinkBreak
 *   limited  → restricted page, no content-script context
 *   busy     → meeting / call / live presentation / high-priority site
 *   focused  → fullscreen active
 *   media    → unpaused media playing
 *   clear    → no contraindications
 */

import type { ActivitySnapshot, ContextVerdict, PageAccessibility, TimerStatus } from "./types";
import { isHighPriorityUrl } from "./high-priority-sites";

/**
 * Determine the current context verdict.
 *
 * @param snapshot        Latest ActivitySnapshot from the content script, or null.
 * @param activeTabUrl    URL of the currently active tab (may be undefined on restricted pages).
 * @param timerStatus     Current timer status (used to detect explicit pause).
 * @param pageAccess      Injectability classification of the active tab.
 */
export function detectContext(
  snapshot: ActivitySnapshot | null,
  activeTabUrl: string | undefined,
  timerStatus: TimerStatus,
  pageAccess: PageAccessibility,
): ContextVerdict {
  // Explicit user pause supersedes everything.
  if (timerStatus === "paused") return "blocked";

  // No content script and page is non-injectable → limited context.
  if (snapshot === null && pageAccess !== "injectable") return "limited";

  // High-priority site — meeting, call, presentation, live stream.
  if (
    isHighPriorityUrl(activeTabUrl) ||
    snapshot?.isHighPrioritySite === true ||
    snapshot?.workType === "meeting"
  ) {
    return "busy";
  }

  // Fullscreen content — treat as focused, not to be interrupted.
  if (snapshot?.fullscreen === true) return "focused";

  // Unpaused media playing.
  if (snapshot?.mediaPlaying === true) return "media";

  return "clear";
}
