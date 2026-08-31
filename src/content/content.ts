import { ActivityTracker } from "./activity-tracker";

const tracker = new ActivityTracker();
tracker.start();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_ACTIVITY_SNAPSHOT") {
    sendResponse(tracker.snapshot());
  }
});
