import { useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  Keyboard,
  LockKeyhole,
  MousePointer2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Brand } from "../shared/components/Brand";
import { Button } from "../shared/components/Button";
import { sendRequest } from "../shared/messages";
import { hasSiteAccess, requestSiteAccess } from "../shared/site-access";

const TOTAL_STEPS = 4;

export function App() {
  const [step, setStep] = useState(0);
  const [interval, setIntervalMinutes] = useState(15);
  const [siteAccess, setSiteAccess] = useState(false);
  const [permissionTried, setPermissionTried] = useState(false);
  const [finished, setFinished] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const initial = window.setTimeout(
      () => void hasSiteAccess().then(setSiteAccess).catch(() => undefined),
      0,
    );
    return () => window.clearTimeout(initial);
  }, []);

  const enableSmartTiming = async () => {
    setPermissionTried(true);
    setBusy(true);
    const granted = await requestSiteAccess().catch(() => false);
    setSiteAccess(granted);
    setBusy(false);
  };

  const finish = async (adaptive = siteAccess) => {
    setBusy(true);
    const response = await sendRequest({
      type: "UPDATE_SETTINGS",
      patch: {
        breakIntervalMinutes: interval,
        smartInterruptionEnabled: adaptive,
        onboardingComplete: true,
      },
    }).catch(() => null);
    if (response?.ok) setFinished(true);
    setBusy(false);
  };

  if (finished) {
    return (
      <main className="onboarding finished-screen">
        <div className="finished-mark"><Check /></div>
        <p className="onboarding-kicker">YOU'RE READY</p>
        <h1>BlinkBreak is listening quietly.</h1>
        <p>
          Your first break begins in about {interval} minutes
          {siteAccess ? " — and I'll wait for a natural pause." : "."}
        </p>
        <Button onClick={() => window.close()}>Start focusing <ArrowRight /></Button>
        <span>You can change any of this from Settings.</span>
      </main>
    );
  }

  return (
    <main className="onboarding">
      <header className="onboarding-header">
        <Brand />
        <button type="button" className="skip-button" onClick={() => void finish(false)}>Skip for now</button>
      </header>

      <div className="onboarding-progress" aria-label={`Step ${step + 1} of ${TOTAL_STEPS}`}>
        {Array.from({ length: TOTAL_STEPS }, (_, index) => (
          <span key={index} className={index <= step ? "active" : ""} />
        ))}
      </div>

      <section className="onboarding-stage" key={step}>
        {step === 0 && <MeetStep />}
        {step === 1 && <NaturalPauseStep />}
        {step === 2 && (
          <PrivacyStep
            granted={siteAccess}
            tried={permissionTried}
            busy={busy}
            onEnable={() => void enableSmartTiming()}
          />
        )}
        {step === 3 && (
          <RhythmStep interval={interval} onInterval={setIntervalMinutes} adaptive={siteAccess} />
        )}
      </section>

      <footer className="onboarding-footer">
        <button
          type="button"
          className="back-button"
          disabled={step === 0}
          onClick={() => setStep((current) => Math.max(0, current - 1))}
        >
          <ArrowLeft /> Back
        </button>
        {step < TOTAL_STEPS - 1 ? (
          <Button onClick={() => setStep((current) => Math.min(TOTAL_STEPS - 1, current + 1))}>
            Continue <ArrowRight />
          </Button>
        ) : (
          <Button disabled={busy} onClick={() => void finish()}>
            Start BlinkBreak <ArrowRight />
          </Button>
        )}
      </footer>
    </main>
  );
}

function MeetStep() {
  return (
    <div className="step-grid meet-step">
      <div className="step-copy">
        <p className="onboarding-kicker">MEET BLINKBREAK</p>
        <h1>Small breaks.<br />Better flow.</h1>
        <p>BlinkBreak gives your eyes a moment without pulling you out of the work that matters.</p>
        <div className="step-promise"><Sparkles /><span><strong>Not another rigid timer</strong><small>Your rhythm comes first.</small></span></div>
      </div>
      <div className="meet-visual" aria-hidden="true">
        <span className="visual-orbit orbit-one" />
        <span className="visual-orbit orbit-two" />
        <div className="visual-eye"><i /><b /></div>
        <span className="visual-caption">pause · blink · relax</span>
      </div>
    </div>
  );
}

function NaturalPauseStep() {
  return (
    <div className="step-grid pause-step">
      <div className="step-copy">
        <p className="onboarding-kicker">SMART WHEN IT HELPS</p>
        <h1>I wait for a<br />better moment.</h1>
        <p>When a break is due, BlinkBreak notices whether you're active and holds the reminder until things settle.</p>
        <div className="step-promise"><Activity /><span><strong>Helpful over interruptive</strong><small>Deterministic, local, and easy to understand.</small></span></div>
      </div>
      <div className="pause-timeline" aria-label="Break waits through activity and appears at a natural pause">
        <div className="timeline-line" />
        <TimelinePoint icon={<Eye />} title="Break due" detail="15:00" tone="normal" />
        <TimelinePoint icon={<Keyboard />} title="Still typing" detail="I'll wait" tone="wait" />
        <TimelinePoint icon={<MousePointer2 />} title="Activity settles" detail="Natural pause" tone="ready" />
        <TimelinePoint icon={<Sparkles />} title="Gentle reminder" detail="Good moment" tone="ready" />
      </div>
    </div>
  );
}

function TimelinePoint({ icon, title, detail, tone }: { icon: React.ReactNode; title: string; detail: string; tone: string }) {
  return <div className={`timeline-point ${tone}`}><span>{icon}</span><div><strong>{title}</strong><small>{detail}</small></div></div>;
}

function PrivacyStep({ granted, tried, busy, onEnable }: { granted: boolean; tried: boolean; busy: boolean; onEnable: () => void }) {
  return (
    <div className="step-grid privacy-step">
      <div className="step-copy">
        <p className="onboarding-kicker">PRIVATE BY DESIGN</p>
        <h1>Your activity stays on this device.</h1>
        <p>BlinkBreak only needs interaction timing and simple page state. Nothing leaves your browser.</p>
        <div className="privacy-mini-list">
          <span><Check /> Never records typed text</span>
          <span><Check /> Never reads page content or URLs</span>
          <span><Check /> No accounts, analytics, or cloud</span>
        </div>
      </div>
      <div className="permission-card">
        <div className="permission-icon"><ShieldCheck /></div>
        <p className="onboarding-kicker">OPTIONAL ACCESS</p>
        <h2>{granted ? "Smart timing is ready" : "Let BlinkBreak notice quiet moments"}</h2>
        <p>{granted ? "Access is local, revocable, and limited to timing signals." : "Chrome will ask permission to run BlinkBreak on regular web pages. This enables adaptive timing and the break overlay."}</p>
        <div className="signal-row"><span><Keyboard /> timing only</span><span><LockKeyhole /> local only</span></div>
        <Button disabled={granted || busy} onClick={onEnable}>
          {granted ? <><Check /> Access allowed</> : "Enable smart timing"}
        </Button>
        {tried && !granted && <small className="permission-declined">That's okay — fixed reminders still work.</small>}
      </div>
    </div>
  );
}

function RhythmStep({ interval, onInterval, adaptive }: { interval: number; onInterval: (value: number) => void; adaptive: boolean }) {
  return (
    <div className="rhythm-step">
      <div className="center-copy">
        <p className="onboarding-kicker">CHOOSE YOUR RHYTHM</p>
        <h1>How often should I look for a pause?</h1>
        <p>This is a starting point. You can adjust it anytime.</p>
      </div>
      <div className="rhythm-options" role="radiogroup" aria-label="Break interval">
        {[10, 15, 20, 25].map((value) => (
          <button type="button" role="radio" aria-checked={interval === value} className={interval === value ? "selected" : ""} key={value} onClick={() => onInterval(value)}>
            <strong>{value}</strong><span>minutes</span>{value === 15 && <small>recommended</small>}
          </button>
        ))}
      </div>
      <div className="rhythm-summary">
        <span className="summary-icon"><Sparkles /></span>
        <p><strong>Every {interval} minutes</strong><span>{adaptive ? "I'll begin listening, then wait if you're in the flow." : "You'll get a simple fixed reminder. Smart timing can be enabled later."}</span></p>
      </div>
    </div>
  );
}
