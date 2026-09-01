import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Brand } from "../shared/components/Brand";
import { Button } from "../shared/components/Button";
import { sendRequest } from "../shared/messages";
import { applyAnimationPreference, applyTheme } from "../shared/theme";
import type { AppSnapshot, TimerState } from "../shared/types";
import { usePageVisibilityLifecycle } from "../shared/use-page-visibility";

function formatCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function remainingMs(timer: TimerState, now: number): number {
  if (timer.status === "paused") return timer.remainingWhenPausedMs ?? 0;
  if (["counting", "deferred"].includes(timer.status)) return Math.max(0, timer.nextBreakDueAt - now);
  return 0;
}

function statusCopy(timer: TimerState, remaining: number) {
  switch (timer.status) {
    case "paused":
      return { label: "Paused", detail: "Your rhythm is on hold", tone: "muted" };
    case "waiting_for_pause":
    case "evaluating":
    case "break_due":
      return { label: "You're in the flow", detail: "I'll wait for a natural pause", tone: "smart" };
    case "prompt_ready":
      return { label: "Good moment for a break", detail: "Your activity just settled", tone: "ready" };
    case "break_active":
      return { label: "Break in progress", detail: "Let your gaze rest", tone: "ready" };
    case "deferred":
      return { label: "No worries, I'll wait", detail: "Your break has been moved", tone: "muted" };
    case "counting":
      return remaining <= 2 * 60_000
        ? { label: "Break coming up", detail: "I'll look for a quiet moment", tone: "smart" }
        : { label: "In a comfortable rhythm", detail: "Smart timing is listening quietly", tone: "normal" };
  }
}

export function App() {
  usePageVisibilityLifecycle();
  const [state, setState] = useState<AppSnapshot | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const theme = state?.settings.theme;
  const animationPreference = state?.settings.animationPreference;

  const refresh = useCallback(async () => {
    const response = await sendRequest({ type: "GET_APP_STATE" });
    if (response.ok && response.state) {
      setState(response.state);
      setError(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh().catch(() => setError(true)), 0);
    const onStorage = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (
        areaName === "local" &&
        ["settings", "timer", "stats"].some((key) => Object.hasOwn(changes, key))
      ) {
        void refresh().catch(() => undefined);
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => {
      window.clearTimeout(initial);
      chrome.storage.onChanged.removeListener(onStorage);
    };
  }, [refresh]);

  useEffect(() => {
    if (!theme || !animationPreference) return;
    applyTheme(theme);
    applyAnimationPreference(animationPreference);
  }, [animationPreference, theme]);

  const act = async (label: string, action: Parameters<typeof sendRequest>[0]) => {
    setPending(label);
    try {
      const response = await sendRequest(action);
      if (response.ok && response.state) setState(response.state);
    } finally {
      setPending(null);
    }
  };

  if (error) {
    return (
      <main className="popup popup-message">
        <Brand />
        <div className="message-mark"><ShieldCheck /></div>
        <h1>BlinkBreak needs a refresh.</h1>
        <p>Reload the extension once, and your local rhythm will be restored.</p>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="popup loading-screen" aria-label="Loading BlinkBreak">
        <span className="loading-dot" />
      </main>
    );
  }

  if (state.timer.status === "break_active") {
    // Break is running in the content-script overlay â€” close popup so it isn't in the way
    window.close();
    return null;
  }

  const goalProgress = Math.min(1, state.stats.completed / state.settings.dailyGoal);

  return (
    <main className="popup">
      <header className="popup-header">
        <div>
          <Brand />
          <p className="tagline">Protect your focus. Give your eyes a moment.</p>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Open BlinkBreak settings"
          onClick={() => void chrome.runtime.openOptionsPage()}
        >
          <Settings />
        </button>
      </header>

      <TimerSection key={state.timer.lastTransitionAt} state={state} />

      <div className="primary-actions">
        <Button
          variant={state.timer.status === "prompt_ready" ? "primary" : "secondary"}
          disabled={pending !== null}
          onClick={() =>
            void act(
              state.timer.status === "paused" ? "resume" : state.timer.status === "prompt_ready" ? "start" : "pause",
              state.timer.status === "paused"
                ? { type: "RESUME_TIMER" }
                : state.timer.status === "prompt_ready"
                  ? { type: "START_BREAK" }
                  : { type: "PAUSE_TIMER" },
            )
          }
        >
          {state.timer.status === "paused" ? <CirclePlay /> : state.timer.status === "prompt_ready" ? <Sparkles /> : <CirclePause />}
          {state.timer.status === "paused" ? "Resume" : state.timer.status === "prompt_ready" ? "Take break" : "Pause"}
        </Button>
        {state.timer.status !== "prompt_ready" && (
          <Button
            variant="ghost"
            disabled={pending !== null}
            onClick={() => {
              // Close popup first so lastFocusedWindow resolves to the real tab,
              // then fire the break â€” background will show the active break overlay directly.
              window.close();
              void sendRequest({ type: "TAKE_BREAK_NOW" });
            }}
          >
            Take a break now
            <ArrowRight />
          </Button>
        )}
      </div>

      <section className="today-card card" aria-labelledby="today-heading">
        <div className="card-heading-row">
          <div>
            <span className="overline" id="today-heading">TODAY</span>
            <strong>{state.stats.completed === 0 ? "Your first reset is ahead" : `${state.stats.completed} quiet reset${state.stats.completed === 1 ? "" : "s"}`}</strong>
          </div>
          <span className="progress-count">{state.stats.completed}<span> / {state.settings.dailyGoal}</span></span>
        </div>
        <div className="progress-track" aria-label={`${state.stats.completed} of ${state.settings.dailyGoal} breaks completed`}>
          <span style={{ transform: `scaleX(${goalProgress})` }} />
        </div>
        <p className="card-note">
          {state.stats.completed === 0
            ? "No pressure. Small pauses add up naturally."
            : state.stats.totalBreakSeconds < 60
              ? `${Math.round(state.stats.totalBreakSeconds)} sec away from the screen so far.`
              : `${Math.round(state.stats.totalBreakSeconds / 60)} min away from the screen so far.`}
        </p>
      </section>

      <button className="adaptive-card" type="button" onClick={() => void chrome.runtime.openOptionsPage()}>
        <span className="adaptive-icon"><Activity /></span>
        <span className="adaptive-copy">
          <strong>{state.settings.smartInterruptionEnabled ? "Adaptive timing is on" : "Fixed timing is on"}</strong>
          <small>
            {state.settings.smartInterruptionEnabled
              ? `${state.settings.breakIntervalMinutes} min rhythm Â· ${state.settings.sensitivity} pause detection`
              : `${state.settings.breakIntervalMinutes} min fixed rhythm`}
          </small>
        </span>
        <ChevronRight />
      </button>

      <footer className="popup-footer">
        <span><ShieldCheck /> Activity stays on this device</span>
        <button type="button" onClick={() => void chrome.runtime.openOptionsPage()}>Settings</button>
      </footer>
    </main>
  );
}

function useTimestampClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    let timer: number | undefined;
    const clear = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      clear();
      if (document.visibilityState !== "visible") return;
      const delay = 1_010 - (Date.now() % 1_000);
      timer = window.setTimeout(() => {
        timer = undefined;
        setNow(Date.now());
        schedule();
      }, delay);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        schedule();
      } else {
        clear();
      }
    };
    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange, { passive: true });
    return () => {
      clear();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [active]);

  return now;
}

function TimerSection({ state }: { state: AppSnapshot }) {
  const clockActive = ["counting", "deferred"].includes(state.timer.status);
  const now = useTimestampClock(clockActive);
  const remaining = remainingMs(state.timer, now);
  const status = statusCopy(state.timer, remaining);
  const intervalMs = state.settings.breakIntervalMinutes * 60_000;
  const progress = ["counting", "deferred", "paused"].includes(state.timer.status)
    ? Math.min(1, Math.max(0, 1 - remaining / intervalMs))
    : 1;

  return (
    <section className="timer-section" aria-labelledby="next-break-heading">
      <div className={`status-pill status-${status.tone}`}>
        <span className="status-pulse" aria-hidden="true" />
        {status.label}
      </div>
      <TimerRing progress={progress} paused={state.timer.status === "paused"}>
        <span className="timer-label" id="next-break-heading">
          {state.timer.status === "paused" ? "TIME HELD" : remaining === 0 ? "BREAK DUE" : "NEXT BREAK"}
        </span>
        <strong className="countdown" role="timer">
          {remaining === 0 && !["paused", "counting", "deferred"].includes(state.timer.status)
            ? "READY"
            : formatCountdown(remaining)}
        </strong>
        <span className="timer-detail">{status.detail}</span>
      </TimerRing>
    </section>
  );
}

function TimerRing({ progress, paused, children }: { progress: number; paused: boolean; children: ReactNode }) {
  const radius = 84;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className={`timer-ring ${paused ? "is-paused" : ""}`}>
      <svg viewBox="0 0 196 196" aria-hidden="true">
        <circle className="ring-track" cx="98" cy="98" r={radius} />
        <circle
          className="ring-progress"
          cx="98"
          cy="98"
          r={radius}
          style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - progress) }}
        />
      </svg>
      <div className="timer-center">{children}</div>
    </div>
  );
}
