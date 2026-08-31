# BlinkBreak development

## Setup

```bash
npm install
npm run build
```

Load `dist/` as an unpacked extension from `chrome://extensions`.

For active development:

```bash
npm run dev
```

This watches source, public assets, and extension HTML entries and rebuilds the complete `dist/` directory. Press **Reload** on the extension card after a successful build. `npm run dev:ui` is available for CSS/layout work, but Chrome APIs only function in the loaded extension.

## Quality commands

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run verify:dist
npm run check
```

`npm run build` also validates Manifest V3, required entry points, icons, explicit CSP, absence of remote scripts and source maps, 64 KiB runtime bundle limits, and a 512 KiB total package budget.

## Project layout

```text
src/
  background/   controller, state machine, adaptive score
  content/      activity tracker and isolated break surface
  popup/        compact daily control surface
  options/      settings, privacy, and daily summary
  onboarding/   first-run education and contextual consent
  shared/       types, defaults, validation, storage, messaging
  styles/       cross-surface design tokens
public/         manifest and generated extension icons
scripts/        build, watch, icon, and artifact validation
```

## Testing philosophy

Unit tests target the deterministic core:

- initial timer scheduling, due transitions, pause/resume, deferral, completion, and restart recovery;
- high/low activity, fullscreen/media, natural pause, and high-to-low transitions;
- default and malformed settings recovery;
- valid/invalid message payloads;
- settings persistence and malformed local storage.
- activity reporting remains silent during ordinary browsing, waits for a quiet window, and cancels cleanly.

Chrome API orchestration is intentionally thin around those pure modules. Always supplement automated checks with the extension acceptance pass below.

## Manual acceptance pass

1. Install from a fresh profile and verify onboarding explains value, adaptive timing, privacy, and optional access within four steps.
2. Allow smart timing and confirm no required all-sites warning appeared at install time.
3. Set the interval to 5 minutes for testing, type rapidly as it expires, and verify the popup says **You’re in the flow — I’ll wait** without an overlay.
4. Stop interacting for at least 16 seconds and verify the calm prompt appears.
5. Test 1, 5, and 10 minute deferrals and **Wait for another pause**.
6. Start a break, navigate to another eligible tab, and verify the in-progress surface is restored with the correct remaining time.
7. Pause, close/reopen the browser, and verify the same remaining time is preserved; resume and verify scheduling continues.
8. Repeat restart recovery with an overdue counting timer and a deferred timer.
9. Test the popup at 320, 380, and 420 CSS pixels; test settings/onboarding at mobile and desktop widths.
10. Complete every flow using only the keyboard, including Escape from prompt and active break.
11. Verify explicit light/dark themes and system theme; enable both OS reduced motion and BlinkBreak’s reduced option.
12. Remove page access in Settings and verify fixed scheduling, popup, and badge continue while page observation stops.
13. Inspect `chrome.storage.local` and verify it contains only `settings`, `timer`, and aggregate `stats`.
14. Inspect the service worker network panel and verify there are no external requests.
15. With smart timing enabled and no break due, inspect the service worker and verify page activity does not wake it periodically.

## Release checklist

- `npm ci && npm run check` passes from a clean checkout.
- `dist/manifest.json` has the intended version and optional permissions.
- No development URLs, source maps, or remote code are packaged.
- Popup, onboarding, options, icon sizes, action badge, and content injection are manually checked in current Chrome.
- `README.md`, `ARCHITECTURE.md`, and `PRIVACY.md` reflect any permission or storage changes.
