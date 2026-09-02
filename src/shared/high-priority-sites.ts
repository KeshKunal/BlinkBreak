/**
 * Protection list for high-priority sites where break popups/overlays must NEVER appear.
 * Includes video calls, meetings, live streams, and presentation modes.
 */

const HIGH_PRIORITY_HOSTNAMES: ReadonlySet<string> = new Set([
  "meet.google.com",
  "zoom.us",
  "app.zoom.us",
  "teams.microsoft.com",
  "teams.live.com",
  "webex.com",
  "whereby.com",
  "discord.com",
  "slack.com",
  "around.co",
  "chime.aws",
  "meet.jit.si",
  "bluejeans.com",
  "gotomeeting.com",
  "loom.com",
  "twitch.tv",
]);

const HIGH_PRIORITY_URL_PATTERNS: readonly RegExp[] = [
  /meet\.google\.com\/.+/i,
  /zoom\.us\/j\/.+/i,
  /teams\.microsoft\.com\/.+/i,
  /webex\.com\/.+/i,
  /discord\.com\/channels\/.+/i,
  /youtube\.com\/live\/.+/i,
  /twitch\.tv\/.+/i,
  /docs\.google\.com\/presentation\/.*\/present/i,
  /canva\.com\/design\/.*\/present/i,
];

export function isHighPriorityDomain(hostname: string): boolean {
  const clean = hostname.toLowerCase().trim();
  if (HIGH_PRIORITY_HOSTNAMES.has(clean)) return true;
  for (const domain of HIGH_PRIORITY_HOSTNAMES) {
    if (clean.endsWith(`.${domain}`)) return true;
  }
  return false;
}

export function isHighPriorityUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (isHighPriorityDomain(parsed.hostname)) return true;
    return HIGH_PRIORITY_URL_PATTERNS.some((pattern) => pattern.test(url));
  } catch {
    return false;
  }
}
