import { ActivityTracker } from "./activity-tracker";
import { BreakSurface } from "./break-surface";
import { sendRequest } from "../shared/messages";

const contentScope = globalThis as typeof globalThis & { __blinkBreakContentLoaded?: boolean };

if (!contentScope.__blinkBreakContentLoaded) {
  contentScope.__blinkBreakContentLoaded = true;
  const tracker = new ActivityTracker();
  const breakSurface = new BreakSurface();
  let tracking = false;
  let reportingRequested = false;

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

  void sendRequest({ type: "CONTENT_READY" })
    .then((response) => {
      const state = response.ok ? response.state : undefined;
      setTracking(Boolean(state?.settings.smartInterruptionEnabled));
      setReporting(
        Boolean(state?.settings.smartInterruptionEnabled && state.timer.status === "waiting_for_pause"),
      );
    })
    .catch(() => undefined);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_ACTIVITY_SNAPSHOT") {
      sendResponse(tracker.snapshot());
    } else if (message?.type === "SHOW_BREAK_PROMPT" && message.state) {
      breakSurface.showPrompt(message.state);
    } else if (message?.type === "SHOW_ACTIVE_BREAK" && message.state) {
      breakSurface.showActive(message.state, message.playSound === true);
    } else if (message?.type === "HIDE_BREAK_UI") {
      breakSurface.hide();
    } else if (message?.type === "SET_ACTIVITY_TRACKING" && typeof message.enabled === "boolean") {
      setTracking(message.enabled);
    } else if (message?.type === "SET_PAUSE_REPORTING" && typeof message.enabled === "boolean") {
      setReporting(message.enabled);
    }
  });
}
