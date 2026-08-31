# BlinkBreak architecture

## System shape

BlinkBreak uses four isolated runtimes:

1. **Manifest V3 service worker** — owns the timer lifecycle, alarms, statistics, action badge, optional content-script registration, and all state mutations.
2. **Content script** — observes content-free interaction timing and renders the break surface in a closed Shadow DOM.
3. **React popup** — displays current state and sends typed user intents.
4. **React options/onboarding pages** — configure the product and request optional access in context.

No server exists. Chrome local storage is the only durable data store.

## Module boundaries

- `src/background/timer-engine.ts` is the pure break-state reducer and restart recovery logic.
- `src/background/interruption-engine.ts` is the pure, interpretable interruption score.
- `src/background/controller.ts` serializes extension events, persists transitions, schedules alarms, and coordinates tabs.
- `src/content/activity-tracker.ts` collects timestamps and booleans only; it is event-driven and sends an explicit quiet signal after 15.5 seconds.
- `src/content/break-surface.ts` owns the prompt, guided break, completion, focus trap, and Shadow DOM design system.
- `src/shared/storage.ts` is the typed `chrome.storage.local` boundary.
- `src/shared/validation.ts` repairs untrusted or obsolete stored data.
- `src/shared/messages.ts` is the allowlisted message protocol and runtime validator.
- `src/shared/site-access.ts` is the optional-permission boundary.

## Break lifecycle

```text
COUNTING
   │ due alarm
   ▼
EVALUATING ── high/medium risk ──▶ WAITING_FOR_PAUSE
   │ low risk                              │ quiet signal / alarm
   ▼                                       └──────────────┐
PROMPT_READY ◀────────────────────────────────────────────┘
   │ take break                 │ later
   ▼                            ▼
BREAK_ACTIVE                 DEFERRED
   │ duration / finish           │ due alarm
   ▼                             └────────▶ EVALUATING
COUNTING
```

Pause is an explicit side state. It stores remaining time instead of allowing wall-clock time to keep advancing.

`transitionTimer()` is the single source of truth for lifecycle transitions. UI components never mutate timer state directly.

## Scheduling and restart recovery

The worker never relies on a long-lived interval. Each state produces at most one `blinkbreak-scheduler` alarm:

- `counting` and `deferred`: wake at `nextBreakDueAt`;
- `waiting_for_pause`: wake at `nextEvaluationAt`;
- `break_active`: wake at the expected completion timestamp;
- `paused` and `prompt_ready`: no timer alarm is necessary.

Durable timestamps include session start, next due time, deferral, next evaluation, break start, last completion, and pause remainder. On every worker start, `recoverTimer()` compares those timestamps with the current clock and enters the correct state.

## Adaptive interruption score

The engine receives one short-lived `ActivitySnapshot`. It never receives actual keys, pointer coordinates, URLs, DOM text, form values, or page content.

Positive risk weights include:

- very recent or sustained keyboard activity;
- dense interaction within 30 seconds;
- recent clicks/scrolling;
- fullscreen state;
- playing HTML media.

Loss of window focus, page invisibility, and at least 15 seconds without interaction lower the score. `low`, `balanced`, and `high` sensitivity select different transparent thresholds. High risk waits 45 seconds, medium waits 30 seconds, and a low-risk quiet signal can advance immediately without polling.

When the script cannot run (for example, a browser-owned page), the engine degrades to a fixed local reminder visible through the extension badge and popup.

## Optional site access

The install manifest contains no required host patterns and no static content script. After informed consent, BlinkBreak requests `scripting` plus ordinary HTTP/HTTPS origins, registers the packaged `content.js`, and injects it into already-open eligible tabs. A global isolated-world marker prevents duplicate listeners.

Turning adaptive timing off stops the activity tracker in every injected tab. Removing page access unregisters the dynamic script; fixed scheduling still works.

## Message security

Every command is a discriminated union and passes `isExtensionRequest()` before the controller sees it. Payload ranges are bounded. Unknown commands are rejected. Pages cannot expose an external connection because the manifest defines no `externally_connectable` entry.

The break surface builds DOM nodes directly and does not inject webpage or user text as HTML.

## Storage model

- `settings`: validated `UserSettings`.
- `timer`: validated `TimerState`.
- `stats`: one local-date `DailyStats` record that resets without streak pressure.

All reads pass through sanitizers. A malformed field falls back or clamps independently, so one bad value cannot crash the UI.

## Performance choices

- Interaction capture is event-driven.
- Pointer movement is sampled at most once every two seconds.
- Activity updates are sent at most every ten seconds, plus context and quiet-state changes.
- The worker serializes mutations through one promise queue to avoid alarm/message races.
- There is no continuous DOM scan, background busy loop, network request, or telemetry client.
