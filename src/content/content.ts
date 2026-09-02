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

contentScope.__blinkBreakContent?.dispose();
document.getElementById("blinkbreak-break-surface")?.remove();

{
  const tracker = new ActivityTracker();
  const breakSurface = new BreakSurface();
  let tracking = false;
  let reportingRequested = false;
  let disposed = false;

  const setTracking = (enabled: boolean): void => {
    if (enabled === tracking) return;
    tracking = enabled;
    if (enabled) {
      tracker.start();
      tracker.setReportingEnabled(reportingRequested);
    }
    else {
      tracker.stop();
    }
  };

  const setReporting = (enabled: boolean): void => {
    reportingRequested = enabled;
    tracker.setReportingEnabled(tracking && reportingRequested);
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

  void sendRequest({ type: "CONTENT_READY" })
    .then((response: BackgroundResponse) => {
      if (disposed) return;
      const state = response.ok ? response.state : undefined;
      setTracking(Boolean(state?.settings.smartInterruptionEnabled));
      setReporting(
        Boolean(state?.settings.smartInterruptionEnabled && state.timer.status === "waiting_for_pause"),
      );
    })
    .catch(() => {
      if (!hasExtensionContext()) registration.dispose();
    });
}
