import type { ActivitySnapshot } from "../shared/types";

type ActivityKind = "keyboard" | "pointer" | "scroll" | "click";

class TimestampWindow {
  private values: number[] = [];
  private head = 0;

  push(value: number, cutoff: number): void {
    this.values.push(value);
    this.prune(cutoff);
  }

  countSince(cutoff: number): number {
    this.prune(cutoff);
    return this.values.length - this.head;
  }

  private prune(cutoff: number): void {
    while (this.head < this.values.length && this.values[this.head] < cutoff) this.head += 1;
    if (this.head > 64 && this.head * 2 >= this.values.length) {
      this.values = this.values.slice(this.head);
      this.head = 0;
    }
  }

  clear(): void {
    this.values = [];
    this.head = 0;
  }
}

export class ActivityTracker {
  private readonly startedAt = Date.now();
  private lastInteractionAt = this.startedAt;
  private lastKeyboardAt = 0;
  private lastPointerAt = 0;
  private lastScrollAt = 0;
  private lastClickAt = 0;
  private interactionTimes = new TimestampWindow();
  private keyboardTimes = new TimestampWindow();
  private playingMedia = new Set<WeakRef<HTMLMediaElement>>();
  private lastPointerEventAt = Number.NEGATIVE_INFINITY;
  private lastScrollEventAt = Number.NEGATIVE_INFINITY;
  private reportingEnabled = false;
  private running = false;
  private idleSignal: number | undefined;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastInteractionAt = Date.now();
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

  }

  stop(): void {
    if (this.running) {
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
      this.running = false;
    }
    this.setReportingEnabled(false);
    this.interactionTimes.clear();
    this.keyboardTimes.clear();
    this.playingMedia.clear();
    this.lastInteractionAt = Date.now();
    this.lastKeyboardAt = 0;
    this.lastPointerAt = 0;
    this.lastScrollAt = 0;
    this.lastClickAt = 0;
    this.lastPointerEventAt = Number.NEGATIVE_INFINITY;
    this.lastScrollEventAt = Number.NEGATIVE_INFINITY;
  }

  setReportingEnabled(enabled: boolean): void {
    if (enabled === this.reportingEnabled) return;
    this.reportingEnabled = enabled;
    if (enabled) this.queueIdleSignal();
    else this.clearIdleSignal();
  }

  snapshot(now = Date.now()): ActivitySnapshot {
    const cutoff = now - 30_000;
    return {
      capturedAt: now,
      pageLoadedAt: this.startedAt,
      lastInteractionAt: this.lastInteractionAt,
      lastKeyboardAt: this.lastKeyboardAt,
      lastPointerAt: this.lastPointerAt,
      lastScrollAt: this.lastScrollAt,
      lastClickAt: this.lastClickAt,
      interactionsIn30Seconds: this.interactionTimes.countSince(cutoff),
      keyboardEventsIn30Seconds: this.keyboardTimes.countSince(cutoff),
      pageVisible: document.visibilityState === "visible",
      windowFocused: document.hasFocus(),
      fullscreen: document.fullscreenElement !== null,
      mediaPlaying: this.hasPlayingMedia(),
    };
  }

  private record(kind: ActivityKind, now = Date.now()): void {
    this.lastInteractionAt = now;
    const cutoff = now - 30_000;
    this.interactionTimes.push(now, cutoff);
    if (kind === "keyboard") {
      this.lastKeyboardAt = now;
      this.keyboardTimes.push(now, cutoff);
    } else if (kind === "pointer") {
      this.lastPointerAt = now;
    } else if (kind === "scroll") {
      this.lastScrollAt = now;
    } else {
      this.lastClickAt = now;
    }
    if (this.reportingEnabled) this.queueIdleSignal();
  }

  private queueIdleSignal(): void {
    this.clearIdleSignal();
    const quietFor = Date.now() - this.lastInteractionAt;
    this.idleSignal = window.setTimeout(() => this.emit(), Math.max(0, 15_500 - quietFor));
  }

  private clearIdleSignal(): void {
    if (this.idleSignal !== undefined) window.clearTimeout(this.idleSignal);
    this.idleSignal = undefined;
  }

  private emit(now = Date.now()): void {
    this.idleSignal = undefined;
    if (
      !this.reportingEnabled ||
      document.visibilityState !== "visible" ||
      !document.hasFocus()
    ) {
      return;
    }
    void chrome.runtime
      .sendMessage({ type: "ACTIVITY_UPDATE", snapshot: this.snapshot(now) })
      .catch(() => undefined);
  }

  private onKeyboard = (): void => this.record("keyboard");

  private onPointer = (event: PointerEvent): void => {
    if (event.timeStamp - this.lastPointerEventAt < 2_000) return;
    this.lastPointerEventAt = event.timeStamp;
    this.record("pointer");
  };

  private onScroll = (event: Event): void => {
    if (event.timeStamp - this.lastScrollEventAt < 500) return;
    this.lastScrollEventAt = event.timeStamp;
    this.record("scroll");
  };
  private onClick = (): void => this.record("click");

  private onContextChange = (): void => {
    if (document.visibilityState === "visible" && document.hasFocus()) {
      if (this.reportingEnabled) this.queueIdleSignal();
    } else {
      this.clearIdleSignal();
    }
  };

  private onMediaPlaying = (event: Event): void => {
    if (event.target instanceof HTMLMediaElement) {
      const alreadyTracked = this.prunePlayingMedia(event.target);
      if (!alreadyTracked) this.playingMedia.add(new WeakRef(event.target));
    }
    if (this.reportingEnabled) this.emit();
  };

  private onMediaStopped = (event: Event): void => {
    if (event.target instanceof HTMLMediaElement) this.removeMedia(event.target);
    if (this.reportingEnabled) this.emit();
  };

  private hasPlayingMedia(): boolean {
    this.prunePlayingMedia();
    return this.playingMedia.size > 0;
  }

  private prunePlayingMedia(match?: HTMLMediaElement): boolean {
    let matched = false;
    for (const reference of this.playingMedia) {
      const media = reference.deref();
      if (!media || media.paused || media.ended || !media.isConnected) {
        this.playingMedia.delete(reference);
      } else if (media === match) {
        matched = true;
      }
    }
    return matched;
  }

  private removeMedia(target: HTMLMediaElement): void {
    for (const reference of this.playingMedia) {
      const media = reference.deref();
      if (!media || media === target) this.playingMedia.delete(reference);
    }
  }
}
