# BlinkBreak privacy

BlinkBreak is local-first by design. It has no account system, backend, advertising SDK, telemetry, crash reporter, or remote configuration.

## Data BlinkBreak stores

Only the following are stored in `chrome.storage.local`:

- your settings;
- timer and recovery timestamps;
- today’s completed/deferred break totals;
- total break time and aggregate session timing for today.

This data stays inside the browser profile and is used only to operate the extension. BlinkBreak does not transmit it.

## Transient activity signals

When smart timing is enabled, the content script keeps short-lived in-memory signals:

- last keyboard, pointer, click, scroll, and general interaction timestamps;
- the current page-load timestamp;
- counts of keyboard and general interactions in the previous 30 seconds;
- whether the page is visible, the window is focused, fullscreen is active, or HTML media is playing.

These signals are reduced to an interruption score locally. They are not written to storage and disappear when the page or service worker closes.

## Data BlinkBreak never collects

BlinkBreak does not record or inspect:

- keys pressed, typed text, passwords, or form values;
- page text, document content, or meeting content;
- URLs, page titles, browsing history, bookmarks, or downloads;
- pointer coordinates;
- screenshots, camera, or microphone;
- cookies, identity, IP address, or personal information.

## Optional page access

Smart timing and the on-page break overlay need permission to run the packaged BlinkBreak script on ordinary HTTP/HTTPS pages. This access is optional, explained during onboarding, and requested through Chrome only after a user action.

Declining leaves BlinkBreak as a fixed local timer. Turning smart timing off stops interaction observation. **Remove page access** in Settings revokes the optional permission entirely.

Browser-owned pages such as `chrome://` and the Chrome Web Store do not permit extension content scripts. On those pages, the toolbar badge and popup remain available.

## Network and offline behavior

The production extension makes no network requests and works offline. All executable code ships inside the extension package, in line with Manifest V3 requirements.

## Data deletion

Uninstalling BlinkBreak removes its local extension storage under normal browser behavior. Users can also remove extension data by clearing the extension’s storage from browser developer tools.

## Wellness scope

BlinkBreak provides general wellness reminders. It does not diagnose, prevent, or treat any medical condition.
