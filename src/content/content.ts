import { ActivityTracker } from "./activity-tracker";
import { BreakSurface } from "./break-surface";
import {
  hasExtensionContext,
  sendRequest,
  type BackgroundResponse,
  type ContentCommand,
} from "../shared/messages";

interface ContentRegistration {
  dispose: () => void;
}

type IncomingContentMessage = ContentCommand | { type: "GET_ACTIVITY_SNAPSHOT" };

const contentScope = globalThis as typeof globalThis & {
  __blinkBreakContent?: ContentRegistration;
};

// Tear down any previous instance from a prior injection in this document.
contentScope.__blinkBreakContent?.dispose();
document.getElementById("blinkbreak-break-surface")?.remove();

{
  const tracker = new ActivityTracker();
  const breakSurface = new BreakSurface();
  let tracking = false;
  let reportingRequested = false;
  let disposed = false;

  /**
   * A unique identifier for this content-script instance.
   * Sent with CONTENT_HELLO so the background can correlate heartbeats and
   * detect stale re-connections across navigations.
   */
  const instanceId = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const setTracking = (enabled: boolean): void => {
    if (enabled === tracking) return;
    tracking = enabled;
    if (enabled) {
      tracker.start();
      tracker.setReportingEnabled(reportingRequested);
    } else {
      tracker.stop();
    }
  };

  const setReporting = (enabled: boolean): void => {
    reportingRequested = enabled;
    tracker.setReportingEnabled(tracking && reportingRequested);
  };

  /** Apply the full sync state received from CONTENT_HELLO response. */
  const applySync = (response: BackgroundResponse): void => {
    if (!response.ok) return;
    setTracking(Boolean(response.trackingEnabled));
    setReporting(Boolean(response.reportingEnabled));
    // The background will push SHOW_ACTIVE_BREAK / HIDE_BREAK_UI via showOnTab,
    // so no explicit break-surface action is needed here.
  };

  const onMessage = (
    message: IncomingContentMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean | undefined => {
    if (message?.type === "PING_CONTENT") {
      sendResponse({ ready: true });
    } else if (message?.type === "GET_ACTIVITY_SNAPSHOT") {
      sendResponse(tracker.snapshot());
    } else if (message?.type === "SHOW_ACTIVE_BREAK" && message.state) {
      breakSurface.showActive(message.state, message.playSound === true);
    } else if (message?.type === "HIDE_BREAK_UI") {
      breakSurface.hide();
    } else if (message?.type === "SET_ACTIVITY_TRACKING" && typeof message.enabled === "boolean") {
      setTracking(message.enabled);
    } else if (message?.type === "SET_PAUSE_REPORTING" && typeof message.enabled === "boolean") {
      setReporting(message.enabled);
    }
    return undefined;
  };

  const registration: ContentRegistration = {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      tracker.stop();
      breakSurface.hide();
      try {
        chrome.runtime.onMessage.removeListener(onMessage);
      } catch {
        // A reloaded extension can invalidate the old runtime before cleanup runs.
      }
      if (contentScope.__blinkBreakContent === registration) {
        delete contentScope.__blinkBreakContent;
      }
    },
  };

  chrome.runtime.onMessage.addListener(onMessage);
  contentScope.__blinkBreakContent = registration;

  // ---------------------------------------------------------------------------
  // CONTENT_HELLO handshake with exponential backoff.
  //
  // This solves the "reload the page" problem: if the service worker is still
  // starting when this content script runs, the first message will fail.
  // Subsequent retries will succeed once the worker is ready.
  //
  // Retry schedule: 100ms → 200ms → 400ms → 800ms → ... → max 30s
  // Max attempts: 8 (covers ~51 seconds of total retry time)
  // ---------------------------------------------------------------------------
  const MAX_HELLO_ATTEMPTS = 8;

  const hello = (attempt = 0): void => {
    if (disposed) return;

    sendRequest({ type: "CONTENT_HELLO", instanceId })
      .then((response: BackgroundResponse) => {
        if (disposed) return;
        applySync(response);
      })
      .catch(() => {
        if (disposed) return;

        // If the extension context has been invalidated (e.g., extension updated),
        // tear down cleanly rather than retrying indefinitely.
        if (!hasExtensionContext()) {
          registration.dispose();
          return;
        }

        if (attempt < MAX_HELLO_ATTEMPTS) {
          const delay = Math.min(100 * Math.pow(2, attempt), 30_000);
          window.setTimeout(() => hello(attempt + 1), delay);
        }
        // If all retries exhausted: silent degradation.
        // The content script continues operating (activity tracking works
        // independently); it just won't have the initial sync state.
        // The background will push commands via showOnTab when it becomes available.
      });
  };

  hello();
}
