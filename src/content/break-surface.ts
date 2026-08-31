import { sendRequest } from "../shared/messages";
import type { AppSnapshot, ThemePreference } from "../shared/types";

const SURFACE_ID = "blinkbreak-break-surface";

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function isDark(theme: ThemePreference): boolean {
  return (
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
}

export class BreakSurface {
  private host: HTMLDivElement | null = null;
  private root: ShadowRoot | null = null;
  private state: AppSnapshot | null = null;
  private tick: number | undefined;
  private delayedTasks = new Set<number>();
  private activeUpdate: (() => number) | null = null;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;
  private previousFocus: Element | null = null;
  private completed = false;
  private view: "prompt" | "active" | "complete" | null = null;
  private activeBreakStartedAt: number | null = null;

  showPrompt(state: AppSnapshot): void {
    if (this.host && this.view === "prompt") {
      this.state = state;
      return;
    }
    this.completed = false;
    if (!this.host) this.mount();
    this.state = state;
    this.view = "prompt";
    this.renderPrompt();
  }

  showActive(state: AppSnapshot, playSound = false): void {
    const startedAt = state.timer.activeBreakStartedAt;
    const alreadyShowing =
      this.host !== null && this.view === "active" && this.activeBreakStartedAt === startedAt;
    if (alreadyShowing) {
      this.state = state;
      return;
    }
    this.completed = false;
    if (!this.host) this.mount();
    this.state = state;
    this.view = "active";
    this.activeBreakStartedAt = startedAt;
    if (playSound) this.playSoftChime();
    this.renderActive();
  }

  hide(): void {
    this.clearViewTasks();
    if (this.keyHandler) document.removeEventListener("keydown", this.keyHandler, true);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.keyHandler = null;
    this.host?.remove();
    this.host = null;
    this.root = null;
    this.view = null;
    this.activeBreakStartedAt = null;
    this.state = null;
    if (this.previousFocus instanceof HTMLElement && this.previousFocus.isConnected) {
      this.previousFocus.focus({ preventScroll: true });
    }
    this.previousFocus = null;
  }

  private mount(): void {
    this.previousFocus = document.activeElement;
    this.host = element("div");
    this.host.id = SURFACE_ID;
    this.host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;display:block;";
    this.root = this.host.attachShadow({ mode: "closed" });
    const style = element("style");
    style.textContent = SURFACE_STYLES;
    this.root.append(style);
    document.documentElement.append(this.host);
    this.installKeyboardHandling();
    document.addEventListener("visibilitychange", this.onVisibilityChange, { passive: true });
    this.onVisibilityChange();
  }

  private shell(): { backdrop: HTMLDivElement; panel: HTMLElement; content: HTMLDivElement } {
    if (!this.root || !this.state) throw new Error("Break surface is not mounted");
    const backdrop = element("div", `backdrop ${isDark(this.state.settings.theme) ? "dark" : "light"}`);
    if (
      this.state.settings.animationPreference === "reduced" ||
      (this.state.settings.animationPreference === "system" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    ) {
      backdrop.dataset.motion = "reduced";
    }
    const panel = element("section", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "bb-title");
    const top = element("div", "topbar");
    const brand = element("div", "brand");
    brand.append(element("span", "brand-eye"), element("span", "brand-text", "BlinkBreak"));
    const quiet = element(
      "span",
      "quiet-label",
      this.view === "active" ? "Guided reset" : this.view === "complete" ? "All set" : "A quiet moment",
    );
    top.append(brand, quiet);
    const content = element("div", "content");
    panel.append(top, content);
    backdrop.append(panel);
    this.root.append(backdrop);
    return { backdrop, panel, content };
  }

  private renderPrompt(): void {
    if (!this.root || !this.state) return;
    this.clearViewTasks();
    this.root.querySelector(".backdrop")?.remove();
    const { content } = this.shell();
    const visual = element("div", "pause-visual");
    visual.append(element("span", "pause-halo"), element("span", "pause-eye"));
    const eyebrow = element("p", "eyebrow", "GOOD MOMENT");
    const title = element("h1", "title", "Give your eyes a moment.");
    title.id = "bb-title";
    const description = element(
      "p",
      "description",
      this.state.timer.consecutiveDeferrals >= 2
        ? "You've been focused for a while. Look toward something farther away and let your gaze soften."
        : "Look toward something farther from your screen and let your gaze soften.",
    );
    const insight = element("div", "insight");
    insight.append(element("span", "insight-dot"), element("span", "insight-text", "I waited until your activity settled."));

    const actions = element("div", "actions");
    const take = element(
      "button",
      "primary",
      `Take ${this.state.settings.breakDurationSeconds} seconds`,
    );
    take.type = "button";
    take.addEventListener("click", () => void this.startBreak());
    const later = element("button", "secondary", "Later");
    later.type = "button";
    later.setAttribute("aria-expanded", "false");
    const deferChoices = this.createDeferralChoices();
    later.addEventListener("click", () => {
      const open = deferChoices.hidden;
      deferChoices.hidden = !open;
      later.setAttribute("aria-expanded", String(open));
      if (open) deferChoices.querySelector<HTMLButtonElement>("button")?.focus();
    });
    actions.append(take, later);
    content.append(visual, eyebrow, title, description, insight, actions, deferChoices);
    this.scheduleTask(() => {
      if (take.isConnected) take.focus();
    }, 30);
  }

  private createDeferralChoices(): HTMLDivElement {
    const wrapper = element("div", "defer-choices");
    wrapper.hidden = true;
    wrapper.setAttribute("aria-label", "Delay this break");
    for (const [label, minutes] of [
      ["1 min", 1],
      ["5 min", 5],
      ["10 min", 10],
    ] as const) {
      const choice = element("button", "choice", label);
      choice.type = "button";
      choice.addEventListener("click", () => void this.defer(minutes));
      wrapper.append(choice);
    }
    const pauseChoice = element("button", "choice choice-wide", "Wait for another pause");
    pauseChoice.type = "button";
    pauseChoice.addEventListener("click", () => void this.defer(1));
    wrapper.append(pauseChoice);
    return wrapper;
  }

  private renderActive(): void {
    if (!this.root || !this.state) return;
    this.clearViewTasks();
    this.root.querySelector(".backdrop")?.remove();
    const { content } = this.shell();
    content.classList.add("active-content");

    const breathing = element("div", "breathing");
    breathing.setAttribute("aria-hidden", "true");
    const eyeTilt = element("span", "eye-tilt");
    const animatedEye = element("span", "animated-eye");
    const pupil = element("span", "eye-pupil");
    pupil.append(element("span", "eye-glint"));
    animatedEye.append(pupil);
    eyeTilt.append(animatedEye);
    breathing.append(element("span", "breathing-orbit"), element("span", "breathing-orbit inner"), eyeTilt);
    const eyebrow = element("p", "eyebrow", "LOOK BEYOND THE SCREEN");
    const title = element("h1", "title", "Let your gaze rest.");
    title.id = "bb-title";
    const guide = element("p", "description guide", "Focus on something farther away.");
    guide.setAttribute("aria-live", "polite");
    const timer = element("div", "timer", "00:20");
    timer.setAttribute("role", "timer");
    timer.setAttribute("aria-label", "Break time remaining");
    const blinkGuide = element("div", "blink-guide");
    blinkGuide.setAttribute("aria-label", "Blink slowly five times");
    const blinkMarks = Array.from({ length: 5 }, () => element("span", "blink-mark"));
    blinkGuide.append(...blinkMarks);
    const finish = element("button", "text-button", "Finish early");
    finish.type = "button";
    finish.addEventListener("click", () => void this.finishBreak());
    content.append(breathing, eyebrow, title, guide, timer, blinkGuide, finish);

    const duration = this.state.settings.breakDurationSeconds;
    const startedAt = this.state.timer.activeBreakStartedAt ?? Date.now();
    let renderedBlinks = -1;
    const update = (): number => {
      const elapsed = Math.max(0, (Date.now() - startedAt) / 1_000);
      const remaining = Math.max(0, duration - elapsed);
      const nextTime = formatTime(remaining);
      if (timer.textContent !== nextTime) timer.textContent = nextTime;
      let nextGuide: string;
      if (elapsed < duration * 0.3) {
        nextGuide = "Focus on something farther away.";
      } else if (elapsed < duration * 0.65) {
        nextGuide = "Breathe gently. Let your eyes relax.";
      } else {
        nextGuide = "Blink slowly, five times.";
      }
      if (guide.textContent !== nextGuide) guide.textContent = nextGuide;
      const completedBlinks = Math.min(5, Math.floor((elapsed / duration) * 6));
      if (completedBlinks !== renderedBlinks) {
        blinkMarks.forEach((mark, index) => mark.classList.toggle("done", index < completedBlinks));
        renderedBlinks = completedBlinks;
      }
      if (remaining <= 0) void this.finishBreak();
      return remaining * 1_000;
    };
    this.activeUpdate = update;
    this.startTicker();
    this.scheduleTask(() => {
      if (finish.isConnected) finish.focus();
    }, 30);
  }

  private renderComplete(): void {
    if (!this.root || !this.state) return;
    this.clearViewTasks();
    this.view = "complete";
    this.activeBreakStartedAt = null;
    this.root.querySelector(".backdrop")?.remove();
    const { backdrop, panel, content } = this.shell();
    backdrop.classList.add("complete-backdrop");
    panel.classList.add("complete-panel");
    content.classList.add("complete-content");
    const success = element("div", "success-mark");
    success.append(element("span", "success-check", "✓"));
    const eyebrow = element("p", "eyebrow", "ALL SET");
    const title = element("h1", "title", "That was enough.");
    title.id = "bb-title";
    const description = element(
      "p",
      "description",
      `Back to focus. Your next reset is in about ${this.state.settings.breakIntervalMinutes} minutes.`,
    );
    const progress = element("div", "completion-progress");
    progress.setAttribute("aria-hidden", "true");
    progress.append(element("span"));
    content.append(success, eyebrow, title, description, progress);
    this.scheduleTask(() => this.hide(), 1_500);
  }

  private async startBreak(): Promise<void> {
    if (!this.state) return;
    const host = this.host;
    this.playSoftChime();
    const response = await sendRequest({ type: "START_BREAK" }).catch(() => null);
    if (this.host === host && response?.ok && response.state) {
      this.showActive(response.state);
    }
  }

  private async defer(minutes: number): Promise<void> {
    await sendRequest({ type: "DEFER_BREAK", minutes }).catch(() => null);
    this.hide();
  }

  private async finishBreak(): Promise<void> {
    if (!this.state || this.completed) return;
    this.completed = true;
    this.clearTicker();
    const host = this.host;
    const startedAt = this.state.timer.activeBreakStartedAt ?? Date.now();
    const elapsedSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1_000));
    const response = await sendRequest({ type: "COMPLETE_BREAK", elapsedSeconds }).catch(() => null);
    if (this.host !== host || !this.root) return;
    if (response?.ok && response.state) this.state = response.state;
    this.renderComplete();
  }

  private playSoftChime(): void {
    if (!this.state?.settings.soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext;
      const context = new AudioContextClass();
      const gain = context.createGain();
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(523.25, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(659.25, context.currentTime + 0.45);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.055, context.currentTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.8);
      oscillator.connect(gain).connect(context.destination);
      oscillator.addEventListener("ended", () => void context.close(), { once: true });
      oscillator.start();
      oscillator.stop(context.currentTime + 0.82);
    } catch {
      // Sound is optional and may be blocked by the page's audio policy.
    }
  }

  private installKeyboardHandling(): void {
    this.keyHandler = (event: KeyboardEvent) => {
      if (!this.root || !this.host) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (this.state?.timer.status === "break_active") void this.finishBreak();
        else void this.defer(this.state?.settings.defaultDeferralMinutes ?? 5);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [...this.root.querySelectorAll<HTMLElement>("button:not([hidden])")].filter(
        (node) => node.offsetParent !== null,
      );
      if (controls.length === 0) return;
      const current = controls.indexOf(this.root.activeElement as HTMLElement);
      if (event.shiftKey && current <= 0) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && current === controls.length - 1) {
        event.preventDefault();
        controls[0].focus();
      }
    };
    document.addEventListener("keydown", this.keyHandler, true);
  }

  private startTicker(): void {
    this.clearTicker();
    if (
      this.view !== "active" ||
      !this.activeUpdate ||
      document.visibilityState !== "visible"
    ) {
      return;
    }
    const remainingMs = this.activeUpdate();
    if (remainingMs <= 0) return;
    this.tick = window.setTimeout(() => {
      this.tick = undefined;
      this.startTicker();
    }, Math.min(1_000, remainingMs));
  }

  private clearTicker(): void {
    if (this.tick !== undefined) window.clearTimeout(this.tick);
    this.tick = undefined;
  }

  private scheduleTask(callback: () => void, delay: number): void {
    const timer = window.setTimeout(() => {
      this.delayedTasks.delete(timer);
      callback();
    }, delay);
    this.delayedTasks.add(timer);
  }

  private clearViewTasks(): void {
    this.clearTicker();
    for (const timer of this.delayedTasks) window.clearTimeout(timer);
    this.delayedTasks.clear();
    this.activeUpdate = null;
  }

  private onVisibilityChange = (): void => {
    const hidden = document.visibilityState !== "visible";
    this.host?.toggleAttribute("data-page-hidden", hidden);
    if (this.view !== "active") return;
    if (hidden) this.clearTicker();
    else this.startTicker();
  };
}

const SURFACE_STYLES = `
  :host { all: initial; }
  :host([data-page-hidden]) *, :host([data-page-hidden]) *::before, :host([data-page-hidden]) *::after {
    animation-play-state: paused !important;
  }
  * { box-sizing: border-box; }
  button { font: inherit; }
  .backdrop {
    --bg: #fbfaf6; --surface: #fff; --text: #1d2521; --muted: #68736d;
    --soft: #e4efeb; --border: #dce1dc; --accent: #1d6b5b; --accent-hover: #15584b;
    position: fixed; inset: 0; display: grid; place-items: center; padding: 24px;
    isolation: isolate; color: var(--text); background: radial-gradient(circle at 50% 46%, rgb(29 107 91 / 11%), transparent 45%), rgb(21 31 26 / 42%);
    font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    animation: bb-fade-in 240ms cubic-bezier(.22,1,.36,1) both;
  }
  .backdrop.dark {
    --bg: #141815; --surface: #1b211d; --text: #eff3ef; --muted: #a4aea8;
    --soft: #213b33; --border: #303a34; --accent: #70b7a4; --accent-hover: #86c4b4;
    background: radial-gradient(circle at 50% 46%, rgb(112 183 164 / 8%), transparent 45%), rgb(5 8 6 / 64%);
  }
  .panel {
    width: min(440px, calc(100vw - 32px)); overflow: hidden; border: 1px solid var(--border);
    border-radius: 28px; background: var(--surface); box-shadow: 0 24px 80px rgb(12 22 16 / 22%), 0 3px 12px rgb(12 22 16 / 8%);
    contain: layout paint style; transform: translateZ(0); animation: bb-rise 440ms cubic-bezier(.22,1,.36,1) both;
  }
  .topbar { display: flex; align-items: center; justify-content: space-between; padding: 20px 22px 0; }
  .brand { display: inline-flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 700; letter-spacing: -.015em; }
  .brand-eye { position: relative; display: block; width: 27px; height: 27px; border-radius: 8px; background: var(--accent); }
  .brand-eye::before { content: ""; position: absolute; width: 15px; height: 9px; left: 6px; top: 9px; border-radius: 80% 20% 80% 20%; transform: rotate(45deg); background: white; opacity: .94; }
  .brand-eye::after { content: ""; position: absolute; width: 4px; height: 4px; left: 12px; top: 12px; border-radius: 50%; background: var(--accent); }
  .quiet-label { color: var(--muted); font-size: 11px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; }
  .content { display: flex; flex-direction: column; align-items: center; padding: 30px 38px 36px; text-align: center; }
  .pause-visual { position: relative; display: grid; width: 96px; height: 96px; margin: 0 0 24px; place-items: center; }
  .pause-halo { position: absolute; inset: 0; border-radius: 50%; background: var(--soft); animation: bb-breathe 5.5s ease-in-out infinite; }
  .pause-eye { position: relative; width: 48px; height: 27px; border: 2px solid var(--accent); border-radius: 80% 20% 80% 20%; transform: rotate(45deg); }
  .pause-eye::before { content: ""; position: absolute; width: 13px; height: 13px; left: 15px; top: 5px; border-radius: 50%; background: var(--accent); }
  .pause-eye::after { content: ""; position: absolute; width: 2px; height: 7px; left: 20px; top: 8px; border-left: 2px solid var(--surface); border-right: 2px solid var(--surface); }
  .eyebrow { margin: 0 0 10px; color: var(--accent); font-size: 11px; font-weight: 750; letter-spacing: .12em; }
  .title { margin: 0; color: var(--text); font-size: 28px; font-weight: 700; line-height: 1.12; letter-spacing: -.035em; }
  .description { max-width: 330px; margin: 13px 0 0; color: var(--muted); font-size: 15px; line-height: 1.55; }
  .insight { display: inline-flex; align-items: center; gap: 8px; margin: 24px 0 0; padding: 9px 12px; border-radius: 999px; color: var(--muted); background: var(--soft); font-size: 11.5px; font-weight: 580; }
  .insight-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 13%, transparent); }
  .actions { display: grid; width: 100%; grid-template-columns: 1.45fr 1fr; gap: 10px; margin: 28px 0 0; }
  button { min-height: 45px; border-radius: 13px; border: 1px solid transparent; padding: 0 16px; cursor: pointer; font-size: 13px; font-weight: 700; transition: transform 140ms ease, background 140ms ease, border-color 140ms ease; }
  button:hover { transform: translateY(-1px); } button:active { transform: scale(.985); }
  button:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 35%, transparent); outline-offset: 2px; }
  .primary { color: white; background: var(--accent); box-shadow: 0 6px 18px color-mix(in srgb, var(--accent) 20%, transparent); }
  .primary:hover { background: var(--accent-hover); }
  .secondary, .choice { color: var(--text); background: transparent; border-color: var(--border); }
  .secondary:hover, .choice:hover { background: var(--soft); }
  .defer-choices { width: 100%; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; animation: bb-reveal 180ms ease-out both; }
  .defer-choices[hidden] { display: none; }
  .choice { min-height: 37px; padding: 0 8px; font-size: 11px; }
  .choice-wide { grid-column: 1 / -1; }
  .active-content { padding-top: 36px; }
  .breathing { position: relative; display: grid; width: 164px; height: 164px; margin: 0 0 28px; place-items: center; }
  .breathing-orbit { position: absolute; inset: 0; border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); border-radius: 50%; animation: bb-breathe-orbit 6s ease-in-out infinite; }
  .breathing-orbit.inner { inset: 22px; border-style: dashed; opacity: .48; animation-delay: .35s; animation-direction: reverse; }
  .eye-tilt { display: grid; width: 106px; height: 66px; place-items: center; transform: rotate(45deg); filter: drop-shadow(0 14px 18px color-mix(in srgb, var(--accent) 18%, transparent)); }
  .animated-eye { position: relative; display: block; width: 94px; height: 56px; overflow: hidden; border: 2px solid var(--accent); border-radius: 100% 0 100% 0; background: var(--surface); transform-origin: 50% 50%; animation: bb-eye-blink 5.8s cubic-bezier(.4,0,.2,1) infinite; }
  .eye-pupil { position: absolute; display: grid; width: 29px; height: 29px; left: 32px; top: 13px; place-items: center; border-radius: 50%; background: var(--accent); animation: bb-eye-gaze 8.5s cubic-bezier(.45,.05,.3,1) infinite; }
  .eye-glint { width: 7px; height: 7px; margin: -9px 0 0 -8px; border-radius: 50%; background: white; opacity: .88; }
  .guide { min-height: 24px; }
  .timer { min-width: 116px; margin: 22px 0 14px; contain: content; transform: translateZ(0); font-variant-numeric: tabular-nums; color: var(--text); font-size: 43px; font-weight: 560; letter-spacing: -.055em; }
  .blink-guide { display: flex; height: 18px; align-items: center; gap: 8px; margin-bottom: 18px; }
  .blink-mark { display: block; width: 16px; height: 3px; border-radius: 999px; background: var(--border); transition: background 280ms ease, transform 280ms ease; }
  .blink-mark.done { background: var(--accent); transform: scaleX(.75); }
  .text-button { min-height: 34px; color: var(--muted); background: transparent; padding: 0 10px; font-weight: 600; }
  .text-button:hover { color: var(--text); }
  .complete-backdrop { animation: bb-fade-in 160ms ease-out both, bb-fade-out 180ms 1.32s ease-in forwards; }
  .complete-panel { width: min(390px, calc(100vw - 32px)); }
  .complete-content { padding: 25px 34px 27px; }
  .complete-content .title { font-size: 25px; }
  .complete-content .description { max-width: 300px; margin-top: 9px; font-size: 13.5px; }
  .success-mark { position: relative; display: grid; width: 72px; height: 72px; margin: 0 0 17px; place-items: center; border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent); border-radius: 50%; color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); box-shadow: 0 10px 30px color-mix(in srgb, var(--accent) 10%, transparent); animation: bb-success 380ms cubic-bezier(.22,1,.36,1) both; }
  .success-mark::before { content: ""; position: absolute; inset: 7px; border: 1px solid color-mix(in srgb, var(--accent) 15%, transparent); border-radius: inherit; }
  .success-check { font-size: 29px; font-weight: 500; line-height: 1; transform: translateY(-1px); }
  .completion-progress { width: 128px; height: 2px; overflow: hidden; margin-top: 21px; border-radius: 999px; background: var(--border); }
  .completion-progress span { display: block; width: 100%; height: 100%; border-radius: inherit; background: var(--accent); transform-origin: left; animation: bb-completion-progress 1.5s linear forwards; }
  @keyframes bb-fade-in { from { opacity: 0; } }
  @keyframes bb-rise { from { opacity: 0; transform: translateY(10px) scale(.985); } }
  @keyframes bb-reveal { from { opacity: 0; transform: translateY(-3px); } }
  @keyframes bb-breathe { 0%,100% { transform: scale(.9); opacity: .72; } 50% { transform: scale(1); opacity: 1; } }
  @keyframes bb-breathe-orbit { 0%,100% { transform: scale(.82); opacity: .35; } 50% { transform: scale(1); opacity: 1; } }
  @keyframes bb-eye-gaze { 0%, 14%, 100% { transform: translate(0, 0); } 29%, 42% { transform: translate(10px, -3px); } 57%, 70% { transform: translate(-9px, 5px); } 82%, 92% { transform: translate(3px, 3px); } }
  @keyframes bb-eye-blink { 0%, 40%, 44%, 72%, 76%, 100% { transform: scaleY(1); } 42%, 74% { transform: scaleY(.08); } }
  @keyframes bb-success { from { opacity: 0; transform: scale(.75); } }
  @keyframes bb-completion-progress { to { transform: scaleX(0); } }
  @keyframes bb-fade-out { to { opacity: 0; } }
  [data-motion="reduced"] *, [data-motion="reduced"] *::before, [data-motion="reduced"] *::after { animation: none !important; transition-duration: .01ms !important; }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition-duration: .01ms !important; } }
  @media (max-width: 480px) { .backdrop { padding: 12px; } .panel { border-radius: 22px; } .content { padding: 25px 24px 30px; } .title { font-size: 25px; } }
`;
