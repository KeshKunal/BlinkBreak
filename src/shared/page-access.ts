/**
 * page-access.ts
 *
 * Classifies a browser tab URL into a PageAccessibility category so that
 * ContentBridge and other callers can decide whether content-script injection
 * is possible — before attempting it and catching an error.
 *
 * This prevents repeated injection attempts on permanently restricted pages
 * and provides a typed reason for diagnostic reporting.
 */

import type { PageAccessibility } from "./types";

/**
 * Known restricted URL scheme prefixes that browser engines block from
 * content-script injection. This list covers Chrome, Edge, and Brave.
 */
const RESTRICTED_SCHEMES = [
  "chrome://",
  "chrome-search://",
  "chrome-untrusted://",
  "chrome-native://",
  "edge://",
  "edge-untrusted://",
  "brave://",
  "about:",
  "data:",
  "javascript:",
  "blob:",     // blob: pages are sandboxed; injection unreliable
  "file://",   // file: requires explicit allowFileAccess permission
  "view-source:",
] as const;

/**
 * The Chrome PDF viewer is hosted at a chrome-extension:// URL.
 * Detecting it by prefix allows special-casing without matching all extension pages.
 */
const CHROME_PDF_VIEWER_PREFIX = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/";

/**
 * Web Store URLs — extension injection is blocked by browsers.
 */
const WEB_STORE_HOSTS = [
  "chrome.google.com",
  "microsoftedge.microsoft.com",
] as const;

/**
 * Classify a tab URL into a PageAccessibility category.
 * Returns `"unknown"` if the URL is absent (tab not yet committed, etc.).
 */
export function classifyUrl(url: string | undefined | null): PageAccessibility {
  if (!url) return "unknown";

  // Chrome / Edge PDF viewer
  if (url.startsWith(CHROME_PDF_VIEWER_PREFIX)) return "pdf";

  // All extension pages (including BlinkBreak's own popup/options)
  if (url.startsWith("chrome-extension://") || url.startsWith("moz-extension://")) {
    return "extension_page";
  }

  // Restricted schemes — no injection possible
  for (const scheme of RESTRICTED_SCHEMES) {
    if (url.startsWith(scheme)) return "restricted_scheme";
  }

  // Web Store pages — injection blocked by browsers
  try {
    const { hostname } = new URL(url);
    for (const host of WEB_STORE_HOSTS) {
      if (hostname === host || hostname.endsWith(`.${host}`)) {
        return "restricted_scheme";
      }
    }
  } catch {
    // Malformed URL — treat as restricted
    return "restricted_scheme";
  }

  return "injectable";
}

/**
 * Returns true if a content script can be injected into a page with this URL.
 * Callers should check this before calling scripting.executeScript or
 * tabs.sendMessage to avoid unnecessary errors.
 */
export function isInjectable(url: string | undefined | null): boolean {
  return classifyUrl(url) === "injectable";
}
