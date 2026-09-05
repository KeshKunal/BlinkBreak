# BlinkBreak architecture

## System shape

BlinkBreak uses four isolated runtimes:

1. **Manifest V3 service worker** — owns the timer lifecycle, alarms, statistics, action badge, optional content-script registration, and all state mutations.
2. **Content script** — observes content-free interaction timing and renders the break surface in a closed Shadow DOM.
3. **React popup** — displays current state and sends typed user intents.
4. **React options/onboarding pages** — configure the product and request optional access in context.

No server exists. Chrome local storage is the only durable data store.

## The four-concept reliability model

BlinkBreak's break timing is based on four independent concepts that must all agree before a break is presented:

**Wall-clock elapsed time alone never causes a break.**

### 1. ExposureTracker (`src/background/exposure-tracker.ts`)
Accumulates *meaningful screen time* toward the break interval — distinct from wall-clock time. Increments only when the user is confirmed present. Pauses automatically during sleep, absence, or SW unavailability.

### 2. PresenceDetector (`src/shared/presence-detector.ts`)
Determines whether the user is at the computer. Classifies the elapsed gap since the last exposure sample into:
- `"present"` — recent confirmed interaction
- `"absent"` — no interaction for > 10 minutes
- `"long_absence"` — gap > 2 hours → session reset
- `"unknown"` — no content script (restricted page); conservative 50% credit applied

### 3. ContextDetector (`src/shared/context-detector.ts`)
Identifies when interruption is contextually inappropriate regardless of how much exposure has accumulated. Verdicts in priority order: `"blocked"` > `"limited"` > `"busy"` > `"focused"` > `"media"` > `"clear"`.

### 4. InterruptionEngine (`src/background/interruption-engine.ts`)
The final arbiter. Takes pre-computed presence and context verdicts plus an `ActivitySnapshot` and produces an `InterruptionDecision` with one of: `show_break`, `wait_for_pause`, `wait_for_context`, `defer_absence`, `session_reset`, `continue`.

## Break lifecycle

```text
ExposureTracker accumulates screen time
    │ goal met
    ▼
PresenceDetector
    │ long_absence → SESSION_RESET (fresh 15-min interval; no break)
    │ absent       → DEFER_ABSENCE (push deadline forward; no break)
    │ present/unknown ↓
    ▼
ContextDetector
    │ blocked  → no break (user paused)
    │ limited  → no break (restricted page, unknown presence)
    │ busy     → WAIT_FOR_PAUSE (300s)
    │ focused  → WAIT_FOR_PAUSE (45s)
    │ media    → WAIT_FOR_PAUSE (30s)
    │ clear    ↓
    ▼
InterruptionEngine (activity scoring)
    │ high/medium risk → WAITING_FOR_PAUSE
    │ low risk / no snapshot → PROMPT_READY
    ▼
BREAK_ACTIVE
    │ duration elapsed / user finishes
    ▼
COUNTING (fresh exposure session)
```

## Module boundaries

- `src/background/timer-engine.ts` is the pure break-state reducer. Includes `SESSION_RESET` and `EXPOSURE_UPDATE` events.
- `src/background/exposure-tracker.ts` computes presence-aware exposure credits (stateless pure functions).
- `src/background/interruption-engine.ts` scores activity and produces `InterruptionDecision` given pre-computed presence/context verdicts.
- `src/background/content-bridge.ts` owns optional script registration, tab messaging, and overlay delivery. Classifies URLs before attempting injection to avoid errors on restricted pages.
- `src/background/controller.ts` orchestrates the four concepts in `evaluateDueBreak()`. Handles `tabs.onUpdated` for navigation lifecycle and `CONTENT_HELLO` for initialization sync.
- `src/background/diagnostics.ts` maintains a lightweight in-memory ring buffer for developer diagnostics. Never shown to end users.
- `src/content/activity-tracker.ts` collects timestamps and booleans only; ordinary activity stays in the page.
- `src/content/break-surface.ts` owns the prompt, guided break, completion, focus trap, and Shadow DOM design system.
- `src/content/content.ts` sends `CONTENT_HELLO` with exponential backoff retry (100ms→30s, 8 attempts max) to synchronize with the service worker after navigation or cold start.
- `src/shared/presence-detector.ts` — pure `detectPresence()` function.
- `src/shared/context-detector.ts` — pure `detectContext()` function.
- `src/shared/page-access.ts` — pure `classifyUrl()` / `isInjectable()` for URL injectability classification.
- `src/shared/browser-compat.ts` — thin `browser` alias over `chrome.*` for Chromium targets.
- `src/shared/storage.ts` is the typed `chrome.storage.local` boundary.
- `src/shared/validation.ts` repairs untrusted or obsolete stored data, including the new exposure fields.
- `src/shared/messages.ts` is the allowlisted message protocol and runtime validator.
- `src/shared/site-access.ts` is the optional-permission boundary.

## Scheduling and restart recovery

The worker never relies on a long-lived interval. Each state produces at most one `blinkbreak-scheduler` alarm. On worker restart, `recoverAppSnapshot()` classifies the elapsed gap:

- Gap < 10 min (ABSENCE_THRESHOLD): resume normally; alarm evaluating if deadline passed.
- Gap 10 min – 2 hours: presence classified as `"absent"`; deadline pushed forward; no break.
- Gap > 2 hours (LONG_ABSENCE_THRESHOLD): `SESSION_RESET` — fresh session, no overdue break.

Durable timestamps survive restart. Existing alarms are reused when their scheduled timestamp is already correct.

## Adaptive interruption score

The engine receives one short-lived `ActivitySnapshot`. It never receives actual keys, pointer coordinates, URLs, DOM text, form values, or page content.

Positive risk weights include:
- very recent or sustained keyboard activity;
- dense interaction within 30 seconds;
- recent clicks/scrolling;
- a page that changed only moments ago;
- fullscreen state;
- playing HTML media.

Loss of window focus, page invisibility, and at least 15 seconds without interaction lower the score.

## Content script lifecycle (CONTENT_HELLO handshake)

```text
Page loads
    ↓
content.ts sends CONTENT_HELLO (with unique instanceId)
    ↓
retry with exponential backoff (100ms → 30s, 8 attempts max)
    ↓
Background sends CONTENT_SYNC_STATE (state, trackingEnabled, reportingEnabled)
    ↓
Content script applies sync state (no page reload needed)
```

If communication is lost, the content script degrades silently — the background continues operating and will push commands via `showOnTab` when reconnection occurs.

## Navigation handling

`controller.ts` subscribes to `chrome.tabs.onUpdated` (`changeInfo.status === "complete"`) and `chrome.tabs.onActivated`. On navigation, the previous script context is torn down by the browser; the new context sends a fresh `CONTENT_HELLO`. The background calls `ensureOnTab()` which classifies the URL before attempting injection — restricted pages are skipped without error.

## Restricted pages

`classifyUrl()` classifies any URL before injection is attempted:
- `"injectable"` — normal http/https
- `"restricted_scheme"` — chrome://, edge://, brave://, about:, data:, file:, view-source:
- `"extension_page"` — chrome-extension://
- `"pdf"` — Chrome PDF viewer
- `"unknown"` — no URL available

When a page is non-injectable:
- No injection is attempted. No error is thrown.
- The presence verdict becomes `"unknown"`; conservative 50% exposure credit is applied.
- The context verdict becomes `"limited"`; no break is shown.
- The popup shows a muted "Limited page access" chip but remains fully functional.

## Cross-browser compatibility

All targets (Chrome, Edge, Brave, other Chromium browsers) use the same `chrome.*` MV3 API surface. A thin `browser` alias in `src/shared/browser-compat.ts` provides a single adaptation point. No polyfills are included.

The extension requires no `tabs` permission. URL classification for injection decisions uses `sender.tab.url` from `CONTENT_HELLO`, which is available without the `tabs` permission.

## Optional site access

The install manifest contains no required host patterns and no static content script. After informed consent, BlinkBreak requests `scripting` plus ordinary HTTP/HTTPS origins, registers the packaged `content.js`, and injects only injectable tabs. A global isolated-world marker prevents duplicate listeners.

## Timer state model (exposure-aware)

`TimerState` carries six new fields:
- `exposureAccumulatedMs` — meaningful screen time accumulated toward the current break interval.
- `exposureGoalMs` — target (mirrors `breakIntervalMinutes × 60_000`).
- `exposureLastSampledAt` — when exposure was last updated; gap detection uses this.
- `lastPresenceConfirmedAt` — last timestamp of confirmed user presence.
- `presenceState` — last known presence verdict (persisted for diagnostics).

`nextBreakDueAt` is now a derived scheduling convenience field, not the source of truth for break decisions.

## Diagnostics

`DiagnosticsCollector` maintains an in-memory ring buffer (last 50 events). The `GET_DIAGNOSTICS` message returns a `DiagnosticSummary` answering: is the current page injectable, is the content script connected, what is the presence/context verdict, and what is the current exposure progress. Developer-oriented only; never shown to end users.

## Message security

Every command is a discriminated union and passes `isExtensionRequest()` before the controller sees it. Payload ranges are bounded. Unknown commands are rejected. `CONTENT_HELLO` carries a required `instanceId` field that is validated before processing.

## Storage model

- `settings`: validated `UserSettings`.
- `timer`: validated `TimerState` (including new exposure fields; old stored data falls back gracefully).
- `stats`: one local-date `DailyStats` record that resets without streak pressure.

All reads pass through sanitizers. A malformed field falls back or clamps independently, so one bad value cannot crash the UI.

## Performance choices

- Interaction capture is event-driven.
- Pointer movement is sampled at most once every two seconds.
- Scroll activity is sampled at most twice per second, and rolling event windows are pruned incrementally.
- Ordinary activity stays inside the page. The worker receives a snapshot only at a due-break evaluation or a single quiet signal while waiting for a pause.
- Playing media is tracked through weak references, so detached page elements cannot be retained.
- The worker serializes mutations through one promise queue to avoid alarm/message races.
- There is no continuous DOM scan, background busy loop, network request, or telemetry client.
- Repeated active-break messages are idempotent, so activity updates cannot remount or flash the overlay.
- Visible countdowns derive from persisted timestamps; no background counter is kept alive.
- Popup clock updates are isolated from static cards and stop outside live timer states.
- Eye, pupil, and breathing motion use transform-only animations and stop under reduced-motion preferences or whenever their page becomes hidden.
