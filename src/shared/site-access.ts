import { sendRequest } from "./messages";

export const SITE_ACCESS = {
  permissions: ["scripting"],
  origins: ["http://*/*", "https://*/*"],
} satisfies chrome.permissions.Permissions;

export async function hasSiteAccess(): Promise<boolean> {
  return chrome.permissions.contains(SITE_ACCESS);
}

export async function requestSiteAccess(): Promise<boolean> {
  const granted = await chrome.permissions.request(SITE_ACCESS);
  if (granted) await sendRequest({ type: "SYNC_SITE_ACCESS" });
  return granted;
}

export async function removeSiteAccess(): Promise<boolean> {
  const removed = await chrome.permissions.remove(SITE_ACCESS);
  if (removed) await sendRequest({ type: "SYNC_SITE_ACCESS" });
  return removed;
}
