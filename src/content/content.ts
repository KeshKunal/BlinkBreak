import { ActivityTracker } from "./activity-tracker";
import { BreakSurface } from "./break-surface";

const tracker = new ActivityTracker();
tracker.start();
const breakSurface = new BreakSurface();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_ACTIVITY_SNAPSHOT") {
    sendResponse(tracker.snapshot());
  } else if (message?.type === "SHOW_BREAK_PROMPT" && message.state) {
    breakSurface.showPrompt(message.state);
  } else if (message?.type === "SHOW_ACTIVE_BREAK" && message.state) {
    breakSurface.showActive(message.state);
  } else if (message?.type === "HIDE_BREAK_UI") {
    breakSurface.hide();
  }
});
