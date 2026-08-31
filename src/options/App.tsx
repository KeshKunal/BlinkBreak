import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  BarChart3,
  Check,
  Clock3,
  Eye,
  Gauge,
  LockKeyhole,
  Palette,
  ShieldCheck,
  Sparkles,
  TimerReset,
} from "lucide-react";
import { Brand } from "../shared/components/Brand";
import { Button } from "../shared/components/Button";
import { Toggle } from "../shared/components/Toggle";
import { sendRequest } from "../shared/messages";
import { hasSiteAccess, removeSiteAccess, requestSiteAccess } from "../shared/site-access";
import { applyAnimationPreference, applyTheme } from "../shared/theme";
import type {
  AnimationPreference,
  AppSnapshot,
  Sensitivity,
  ThemePreference,
  UserSettings,
} from "../shared/types";
import { usePageVisibilityLifecycle } from "../shared/use-page-visibility";

type SaveState = "idle" | "saving" | "saved" | "error";

export function App() {
  usePageVisibilityLifecycle();
  const [state, setState] = useState<AppSnapshot | null>(null);
  const [siteAccess, setSiteAccess] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [permissionNote, setPermissionNote] = useState<string | null>(null);
  const saveResetTimer = useRef<number | undefined>(undefined);
  const theme = state?.settings.theme;
  const animationPreference = state?.settings.animationPreference;

  const load = useCallback(async () => {
    const [response, access] = await Promise.all([
      sendRequest({ type: "GET_APP_STATE" }),
      hasSiteAccess(),
    ]);
    if (response.ok && response.state) setState(response.state);
    setSiteAccess(access);
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(initial);
      if (saveResetTimer.current !== undefined) window.clearTimeout(saveResetTimer.current);
    };
  }, [load]);

  useEffect(() => {
    if (!theme || !animationPreference) return;
    applyTheme(theme);
    applyAnimationPreference(animationPreference);
  }, [animationPreference, theme]);

  const update = async (patch: Partial<UserSettings>) => {
    if (!state) return;
    const previous = state;
    setState({ ...state, settings: { ...state.settings, ...patch } });
    setSaveState("saving");
    try {
      const response = await sendRequest({ type: "UPDATE_SETTINGS", patch });
      if (!response.ok || !response.state) throw new Error("Save failed");
      setState(response.state);
      setSaveState("saved");
      if (saveResetTimer.current !== undefined) window.clearTimeout(saveResetTimer.current);
      saveResetTimer.current = window.setTimeout(() => {
        saveResetTimer.current = undefined;
        setSaveState("idle");
      }, 1_800);
    } catch {
      if (saveResetTimer.current !== undefined) window.clearTimeout(saveResetTimer.current);
      saveResetTimer.current = undefined;
      setState(previous);
      setSaveState("error");
    }
  };

  const toggleAdaptive = async (enabled: boolean) => {
    if (enabled && !siteAccess) {
      const granted = await requestSiteAccess().catch(() => false);
      setSiteAccess(granted);
      if (!granted) {
        setPermissionNote("Smart timing stays off until you choose to allow page activity access.");
        return;
      }
      setPermissionNote(null);
    }
    await update({ smartInterruptionEnabled: enabled });
  };

  const revokeAccess = async () => {
    await update({ smartInterruptionEnabled: false });
    const removed = await removeSiteAccess().catch(() => false);
    if (removed) {
      setSiteAccess(false);
      setPermissionNote("Page access removed. BlinkBreak now runs as a fixed local timer.");
    }
  };

  if (!state) {
    return <main className="loading-screen"><span className="loading-dot" /></main>;
  }

  const averageInterval = state.stats.completed > 0
    ? Math.round(state.stats.totalCompletedIntervalMs / state.stats.completed / 60_000)
    : null;
  const longestMinutes = Math.round(state.stats.longestUninterruptedMs / 60_000);
  const breakTime = state.stats.totalBreakSeconds < 60
    ? `${Math.round(state.stats.totalBreakSeconds)}s`
    : `${Math.round(state.stats.totalBreakSeconds / 60)}m`;

  return (
    <div className="settings-layout">
      <aside className="settings-sidebar">
        <Brand />
        <nav aria-label="Settings sections">
          <a href="#schedule"><Clock3 /> Break schedule</a>
          <a href="#interruption"><Activity /> Smart timing</a>
          <a href="#experience"><Palette /> Experience</a>
          <a href="#privacy"><ShieldCheck /> Privacy</a>
          <a href="#statistics"><BarChart3 /> Today</a>
        </nav>
        <div className="sidebar-trust">
          <LockKeyhole />
          <p><strong>Local by design</strong><span>No account. No cloud. No tracking.</span></p>
        </div>
      </aside>

      <main className="settings-main">
        <header className="settings-header">
          <div>
            <p className="settings-kicker">SETTINGS</p>
            <h1>Make your rhythm feel natural.</h1>
            <p>Small adjustments, quieter interruptions, and no pressure.</p>
          </div>
          <div className={`save-state save-${saveState}`} aria-live="polite">
            {saveState === "saving" && "Saving…"}
            {saveState === "saved" && <><Check /> Saved locally</>}
            {saveState === "error" && "Couldn't save — try again"}
          </div>
        </header>

        <SettingsSection
          id="schedule"
          icon={<Clock3 />}
          eyebrow="BREAK SCHEDULE"
          title="A rhythm you can keep"
          description="Choose a gentle cadence. Smart timing may wait beyond it when you're busy."
        >
          <SettingRow title="Time between breaks" description="When BlinkBreak begins looking for a pause.">
            <ChoiceGroup
              label="Break interval"
              value={state.settings.breakIntervalMinutes}
              options={[10, 15, 20, 25]}
              suffix="min"
              onChange={(value) => void update({ breakIntervalMinutes: value })}
            />
            <NumberSetting
              label="Custom interval"
              value={state.settings.breakIntervalMinutes}
              min={5}
              max={120}
              suffix="min"
              onCommit={(value) => void update({ breakIntervalMinutes: value })}
            />
          </SettingRow>
          <SettingRow title="Break length" description="Long enough to reset, short enough to repeat.">
            <ChoiceGroup
              label="Break duration"
              value={state.settings.breakDurationSeconds}
              options={[10, 20, 30, 45]}
              suffix="sec"
              onChange={(value) => void update({ breakDurationSeconds: value })}
            />
            <NumberSetting
              label="Custom duration"
              value={state.settings.breakDurationSeconds}
              min={10}
              max={120}
              suffix="sec"
              onCommit={(value) => void update({ breakDurationSeconds: value })}
            />
          </SettingRow>
          <SettingRow title="Gentle daily target" description="A progress guide, never a streak or score.">
            <NumberSetting
              label="Daily break target"
              value={state.settings.dailyGoal}
              min={1}
              max={24}
              suffix="breaks"
              onCommit={(value) => void update({ dailyGoal: value })}
            />
          </SettingRow>
        </SettingsSection>

        <SettingsSection
          id="interruption"
          icon={<Sparkles />}
          eyebrow="SMART TIMING"
          title="Helpful, not interruptive"
          description="BlinkBreak reads the moment, not the page."
        >
          <SettingRow
            title="Wait for a natural pause"
            description={siteAccess ? "Uses interaction timing, focus, fullscreen, and media state." : "Enable optional page access to find quiet moments."}
            action={<Toggle checked={state.settings.smartInterruptionEnabled && siteAccess} onChange={(value) => void toggleAdaptive(value)} label="Wait for a natural pause" />}
          />
          {permissionNote && <div className="inline-note" role="status">{permissionNote}</div>}
          <SettingRow title="Pause sensitivity" description="Higher sensitivity waits through more kinds of activity.">
            <TextChoiceGroup<Sensitivity>
              label="Pause sensitivity"
              value={state.settings.sensitivity}
              options={[
                { value: "low", label: "Relaxed" },
                { value: "balanced", label: "Balanced" },
                { value: "high", label: "Cautious" },
              ]}
              disabled={!state.settings.smartInterruptionEnabled || !siteAccess}
              onChange={(value) => void update({ sensitivity: value })}
            />
          </SettingRow>
          <SettingRow title="Default delay" description="The one-click Later choice on a break prompt.">
            <ChoiceGroup
              label="Default delay"
              value={state.settings.defaultDeferralMinutes}
              options={[1, 5, 10]}
              suffix="min"
              onChange={(value) => void update({ defaultDeferralMinutes: value })}
            />
          </SettingRow>
        </SettingsSection>

        <SettingsSection
          id="experience"
          icon={<Palette />}
          eyebrow="EXPERIENCE"
          title="Calm in every mode"
          description="Keep the signature feeling, or make it almost still."
        >
          <SettingRow
            title="Soft chime"
            description="A quiet two-note cue when a break begins. Off by default."
            action={<Toggle checked={state.settings.soundEnabled} onChange={(value) => void update({ soundEnabled: value })} label="Soft break chime" />}
          />
          <SettingRow title="Theme" description="System follows your browser and operating system.">
            <TextChoiceGroup<ThemePreference>
              label="Color theme"
              value={state.settings.theme}
              options={[
                { value: "system", label: "System" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
              onChange={(value) => void update({ theme: value })}
            />
          </SettingRow>
          <SettingRow title="Motion" description="Reduced removes breathing and decorative transitions.">
            <TextChoiceGroup<AnimationPreference>
              label="Animation preference"
              value={state.settings.animationPreference}
              options={[
                { value: "system", label: "System" },
                { value: "full", label: "Gentle" },
                { value: "reduced", label: "Reduced" },
              ]}
              onChange={(value) => void update({ animationPreference: value })}
            />
          </SettingRow>
        </SettingsSection>

        <section className="privacy-panel" id="privacy">
          <div className="privacy-mark"><ShieldCheck /></div>
          <div>
            <p className="settings-kicker">PRIVACY</p>
            <h2>Your work stays yours.</h2>
            <p>BlinkBreak processes activity signals locally on your device. It does not record keystrokes, typed content, screenshots, page content, URLs, or browsing history.</p>
            <div className="privacy-points">
              <span><Check /> No account</span>
              <span><Check /> No analytics</span>
              <span><Check /> Works offline</span>
            </div>
            {siteAccess && (
              <Button variant="secondary" onClick={() => void revokeAccess()}>Remove page access</Button>
            )}
          </div>
        </section>

        <section className="stats-section" id="statistics">
          <div className="section-intro">
            <span className="section-icon"><BarChart3 /></span>
            <div><p className="settings-kicker">TODAY</p><h2>A quiet summary</h2><p>Useful context without competition.</p></div>
          </div>
          <div className="stats-grid">
            <Stat icon={<Eye />} value={String(state.stats.completed)} label="Breaks completed" />
            <Stat icon={<TimerReset />} value={breakTime} label="Time looking away" />
            <Stat icon={<Gauge />} value={averageInterval ? `${averageInterval}m` : "—"} label="Average interval" />
            <Stat icon={<Activity />} value={String(state.stats.deferred)} label="Breaks deferred" />
            <Stat icon={<Sparkles />} value={String(state.stats.focusSessions)} label="Focus sessions" />
            <Stat icon={<Clock3 />} value={longestMinutes ? `${longestMinutes}m` : "—"} label="Longest session" />
          </div>
          <p className="stats-footnote">{longestMinutes > 0 ? `Longest uninterrupted session today: ${longestMinutes} min.` : "Your first completed break will add detail here."}</p>
        </section>

        <footer className="settings-footer"><Brand /><span>BlinkBreak 1.0 · Local-first by design</span></footer>
      </main>
    </div>
  );
}

function SettingsSection({ id, icon, eyebrow, title, description, children }: { id: string; icon: ReactNode; eyebrow: string; title: string; description: string; children: ReactNode }) {
  return (
    <section className="settings-section" id={id}>
      <div className="section-intro"><span className="section-icon">{icon}</span><div><p className="settings-kicker">{eyebrow}</p><h2>{title}</h2><p>{description}</p></div></div>
      <div className="settings-card card">{children}</div>
    </section>
  );
}

function SettingRow({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-copy"><strong>{title}</strong><span>{description}</span></div>
      {action && <div className="setting-action">{action}</div>}
      {children && <div className="setting-controls">{children}</div>}
    </div>
  );
}

function ChoiceGroup({ label, value, options, suffix, onChange }: { label: string; value: number; options: number[]; suffix: string; onChange: (value: number) => void }) {
  return <div className="choice-group" role="group" aria-label={label}>{options.map((option) => <button type="button" className={value === option ? "selected" : ""} aria-pressed={value === option} key={option} onClick={() => onChange(option)}>{option} <small>{suffix}</small></button>)}</div>;
}

function TextChoiceGroup<T extends string>({ label, value, options, disabled = false, onChange }: { label: string; value: T; options: { value: T; label: string }[]; disabled?: boolean; onChange: (value: T) => void }) {
  return <div className="choice-group text-choices" role="group" aria-label={label}>{options.map((option) => <button type="button" disabled={disabled} className={value === option.value ? "selected" : ""} aria-pressed={value === option.value} key={option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

function NumberSetting({ label, value, min, max, suffix, onCommit }: { label: string; value: number; min: number; max: number; suffix: string; onCommit: (value: number) => void }) {
  return <label className="number-setting"><span className="sr-only">{label}</span><input key={value} type="number" defaultValue={value} min={min} max={max} onBlur={(event) => onCommit(Math.min(max, Math.max(min, Number(event.currentTarget.value) || value)))} /><span>{suffix}</span></label>;
}

function Stat({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return <article className="stat-card"><span>{icon}</span><strong>{value}</strong><small>{label}</small></article>;
}
