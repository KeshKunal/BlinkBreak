import type { ActivitySnapshot } from "../shared/types";

type ActivityKind = "keyboard" | "pointer" | "scroll" | "click";

export class ActivityTracker {
  private readonly startedAt = Date.now();
  private lastInteractionAt = this.startedAt;
  private lastKeyboardAt = 0;
  private lastPointerAt = 0;
  private lastScrollAt = 0;
  private lastClickAt = 0;
  private interactionTimes: number[] = [];
  private keyboardTimes: number[] = [];
  private playingMedia = new Set<HTMLMediaElement>();
  private lastPointerSampleAt = 0;
  private lastSentAt = 0;
  private idleSignal: number | undefined;

  start(): void {
    document.addEventListener("keydown", this.onKeyboard, { capture: true, passive: true });
    document.addEventListener("pointermove", this.onPointer, { capture: true, passive: true });
    document.addEventListener("pointerdown", this.onClick, { capture: true, passive: true });
    document.addEventListener("scroll", this.onScroll, { capture: true, passive: true });
    document.addEventListener("visibilitychange", this.onContextChange, { passive: true });
    document.addEventListener("fullscreenchange", this.onContextChange, { passive: true });
    window.addEventListener("focus", this.onContextChange, { passive: true });
    window.addEventListener("blur", this.onContextChange, { passive: true });
    document.addEventListener("playing", this.onMediaPlaying, true);
    document.addEventListener("pause", this.onMediaStopped, true);
    document.addEventListener("ended", this.onMediaStopped, true);

    window.setTimeout(() => this.emit(), 800);
    this.queueIdleSignal();
  }

  stop(): void {
    document.removeEventListener("keydown", this.onKeyboard, true);
    document.removeEventListener("pointermove", this.onPointer, true);
    document.removeEventListener("pointerdown", this.onClick, true);
    document.removeEventListener("scroll", this.onScroll, true);
    document.removeEventListener("visibilitychange", this.onContextChange);
    document.removeEventListener("fullscreenchange", this.onContextChange);
    window.removeEventListener("focus", this.onContextChange);
    window.removeEventListener("blur", this.onContextChange);
    document.removeEventListener("playing", this.onMediaPlaying, true);
    document.removeEventListener("pause", this.onMediaStopped, true);
    document.removeEventListener("ended", this.onMediaStopped, true);
    if (this.idleSignal !== undefined) window.clearTimeout(this.idleSignal);
    this.idleSignal = undefined;
    this.playingMedia.clear();
  }

  snapshot(now = Date.now()): ActivitySnapshot {
    this.prune(now);
    return {
      capturedAt: now,
      lastInteractionAt: this.lastInteractionAt,
      lastKeyboardAt: this.lastKeyboardAt,
      lastPointerAt: this.lastPointerAt,
      lastScrollAt: this.lastScrollAt,
      lastClickAt: this.lastClickAt,
      interactionsIn30Seconds: this.interactionTimes.length,
      keyboardEventsIn30Seconds: this.keyboardTimes.length,
      pageVisible: document.visibilityState === "visible",
      windowFocused: document.hasFocus(),
      fullscreen: document.fullscreenElement !== null,
      mediaPlaying: this.playingMedia.size > 0,
    };
  }

  private record(kind: ActivityKind, now = Date.now()): void {
    this.lastInteractionAt = now;
    this.interactionTimes.push(now);
    if (kind === "keyboard") {
      this.lastKeyboardAt = now;
      this.keyboardTimes.push(now);
    } else if (kind === "pointer") {
      this.lastPointerAt = now;
    } else if (kind === "scroll") {
      this.lastScrollAt = now;
    } else {
      this.lastClickAt = now;
    }
    this.prune(now);
    this.queueIdleSignal();
    if (now - this.lastSentAt >= 10_000) this.emit(now);
  }

  private prune(now: number): void {
    const cutoff = now - 30_000;
    this.interactionTimes = this.interactionTimes.filter((time) => time >= cutoff);
    this.keyboardTimes = this.keyboardTimes.filter((time) => time >= cutoff);
  }

  private queueIdleSignal(): void {
    if (this.idleSignal !== undefined) window.clearTimeout(this.idleSignal);
    this.idleSignal = window.setTimeout(() => this.emit(), 15_500);
  }

  private emit(now = Date.now()): void {
    this.lastSentAt = now;
    void chrome.runtime
      .sendMessage({ type: "ACTIVITY_UPDATE", snapshot: this.snapshot(now) })
      .catch(() => undefined);
  }

  private onKeyboard = (): void => this.record("keyboard");

  private onPointer = (): void => {
    const now = Date.now();
    if (now - this.lastPointerSampleAt < 2_000) return;
    this.lastPointerSampleAt = now;
    this.record("pointer", now);
  };

  private onScroll = (): void => this.record("scroll");
  private onClick = (): void => this.record("click");

  private onContextChange = (): void => {
    this.emit();
  };

  private onMediaPlaying = (event: Event): void => {
    if (event.target instanceof HTMLMediaElement) this.playingMedia.add(event.target);
    this.emit();
  };

  private onMediaStopped = (event: Event): void => {
    if (event.target instanceof HTMLMediaElement) this.playingMedia.delete(event.target);
    this.emit();
  };
}
