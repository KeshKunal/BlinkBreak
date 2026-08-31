import { ActivityTracker } from "./activity-tracker";
import { BreakSurface } from "./break-surface";
import { sendRequest } from "../shared/messages";

const tracker = new ActivityTracker();
const breakSurface = new BreakSurface();
let tracking = false;

function setTracking(enabled: boolean): void {
  if (enabled === tracking) return;
  tracking = enabled;
  if (enabled) tracker.start();
  else tracker.stop();
}

void sendRequest({ type: "GET_APP_STATE" })
  .then((response) => setTracking(Boolean(response.ok && response.state?.settings.smartInterruptionEnabled)))
  .catch(() => undefined);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_ACTIVITY_SNAPSHOT") {
    sendResponse(tracker.snapshot());
  } else if (message?.type === "SHOW_BREAK_PROMPT" && message.state) {
    breakSurface.showPrompt(message.state);
  } else if (message?.type === "SHOW_ACTIVE_BREAK" && message.state) {
    breakSurface.showActive(message.state);
  } else if (message?.type === "HIDE_BREAK_UI") {
    breakSurface.hide();
  } else if (message?.type === "SET_ACTIVITY_TRACKING" && typeof message.enabled === "boolean") {
    setTracking(message.enabled);
  }
});
