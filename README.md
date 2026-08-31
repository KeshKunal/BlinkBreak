# BlinkBreak

BlinkBreak is a privacy-first Chrome extension for eye breaks that waits for a natural pause instead of interrupting on the exact second a timer expires.

> Your break is due. If you are in the flow, BlinkBreak waits.

## Why it feels different

- **Adaptive timing:** recent interaction, focus, fullscreen, and media signals feed an interpretable local risk score.
- **Calm break experience:** a restrained prompt, gently moving and blinking eye, blink guidance, and an always-available exit.
- **Reliable scheduling:** persisted timestamps plus Chrome alarms survive service-worker suspension, sleep, restarts, and extension reloads.
- **No surveillance:** no typed text, page content, URLs, screenshots, browsing history, accounts, analytics, or backend.
- **User-controlled access:** page access is optional and requested only after the product explains why it helps.
- **Accessible by default:** semantic controls, visible focus, full keyboard support, light/dark themes, and reduced motion.

BlinkBreak offers general wellness guidance and makes no medical claims.

## Product surfaces

- Compact popup with current state, next-break countdown, pause/resume, today’s progress, and transparent adaptive status.
- Isolated on-page prompt and 10–120 second break flow.
- Four-step first-run onboarding with contextual optional permission consent.
- Settings for interval, duration, pause sensitivity, deferral, sound, theme, motion, and a gentle daily target.
- A small local daily summary with completed/deferred breaks, focus sessions, average timing, and longest session.

## Install locally

Requirements: Node.js 20 or newer and a Chromium browser.

```bash
npm install
npm run check
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the generated `dist/` directory.
5. Complete the BlinkBreak onboarding tab.

`npm run build` always produces a validated, loadable Manifest V3 extension in `dist/`.

## Development

```bash
npm run dev       # rebuild dist/ when extension source changes
npm run typecheck
npm run lint
npm run test
npm run build
npm run check     # all release checks
```

After a development rebuild, use **Reload** on `chrome://extensions`. See [DEVELOPMENT.md](./DEVELOPMENT.md) for the complete workflow and manual acceptance checklist.

## Permissions

| Permission | When | Why |
| --- | --- | --- |
| `storage` | Required | Saves settings, timer timestamps, and daily totals locally. |
| `alarms` | Required | Reliably wakes the Manifest V3 worker when a break is due. |
| `scripting` | Optional | Installs the privacy-safe activity listener after consent. |
| `http://*/*`, `https://*/*` | Optional | Enables natural-pause detection and the break overlay on ordinary pages. |

There is no notification, history, tabs, cookies, identity, network interception, or clipboard permission. Fixed local scheduling remains available when optional page access is declined.

## Architecture

The implementation separates UI, persistent scheduling, pure state transitions, activity capture, interruption scoring, messaging validation, storage validation, and the on-page break surface. Start with [ARCHITECTURE.md](./ARCHITECTURE.md); privacy details live in [PRIVACY.md](./PRIVACY.md).

## License

MIT
