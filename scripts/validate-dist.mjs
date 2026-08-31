import { access, readFile, readdir, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

const root = resolve("dist");
const manifestPath = resolve(root, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const MAX_RUNTIME_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024;

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? collectFiles(path) : [path];
    }),
  );
  return nested.flat();
}

if (manifest.manifest_version !== 3) throw new Error("Build must use Manifest V3");
const minimumChromeVersion = Number(manifest.minimum_chrome_version);
if (!Number.isFinite(minimumChromeVersion) || minimumChromeVersion < 120) {
  throw new Error("Production bundle target requires Chrome 120 or newer");
}
if (!manifest.background?.service_worker) throw new Error("Background service worker is missing");
if (!manifest.action?.default_popup) throw new Error("Popup entry is missing");
if (manifest.host_permissions?.length) {
  throw new Error("Install-time host access is not allowed; use optional_host_permissions");
}
if (manifest.externally_connectable) throw new Error("External extension messaging is not allowed");

const unexpectedRequiredPermission = (manifest.permissions ?? []).find(
  (permission) => !["alarms", "storage"].includes(permission),
);
if (unexpectedRequiredPermission) {
  throw new Error(`Unexpected required permission: ${unexpectedRequiredPermission}`);
}
const unexpectedOptionalPermission = (manifest.optional_permissions ?? []).find(
  (permission) => permission !== "scripting",
);
if (unexpectedOptionalPermission) {
  throw new Error(`Unexpected optional permission: ${unexpectedOptionalPermission}`);
}
const allowedOptionalOrigins = new Set(["http://*/*", "https://*/*"]);
if (
  (manifest.optional_host_permissions ?? []).some(
    (permission) => !allowedOptionalOrigins.has(permission),
  )
) {
  throw new Error("Unexpected optional host permission");
}

const extensionCsp = manifest.content_security_policy?.extension_pages ?? "";
if (!extensionCsp.includes("script-src 'self'") || !extensionCsp.includes("object-src 'none'")) {
  throw new Error("Extension pages must enforce the production content security policy");
}
if (
  extensionCsp.includes("unsafe-eval") ||
  extensionCsp.includes("http:") ||
  extensionCsp.includes("https:")
) {
  throw new Error("Extension content security policy allows unsafe code");
}

const required = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_page,
  "onboarding.html",
  "content.js",
  ...Object.values(manifest.icons ?? {}),
];

for (const relativePath of new Set(required)) {
  if (typeof relativePath !== "string") throw new Error("Manifest contains an invalid file path");
  const path = resolve(root, relativePath);
  if (!path.startsWith(`${root}${sep}`)) throw new Error("Manifest path escapes the package root");
  await access(path);
}

const backgroundSize = (await stat(resolve(root, manifest.background.service_worker))).size;
const contentSize = (await stat(resolve(root, "content.js"))).size;
if (backgroundSize === 0 || contentSize === 0) throw new Error("Extension runtime bundle is empty");
if (backgroundSize > MAX_RUNTIME_BYTES || contentSize > MAX_RUNTIME_BYTES) {
  throw new Error(
    `Runtime bundle budget exceeded (background ${backgroundSize} B, content ${contentSize} B)`,
  );
}

const files = await collectFiles(root);
const sourceMaps = files.filter((path) => path.endsWith(".map"));
if (sourceMaps.length > 0) throw new Error("Source maps must not be packaged in production");

const totalBytes = (
  await Promise.all(files.map(async (path) => (await stat(path)).size))
).reduce((total, size) => total + size, 0);
if (totalBytes > MAX_TOTAL_BYTES) {
  throw new Error(`Extension package budget exceeded (${totalBytes} B)`);
}

const htmlFiles = files.filter((path) => path.endsWith(".html"));
for (const path of htmlFiles) {
  const html = await readFile(path, "utf8");
  if (/\b(?:src|href)=["']https?:/iu.test(html)) {
    throw new Error(`Remote asset found in ${path}`);
  }
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)) {
    if (!/\bsrc=["'][^"']+["']/iu.test(script[1])) {
      throw new Error(`Inline script found in ${path}`);
    }
  }
}

console.log(
  `Validated Manifest V3 build (${required.length} referenced assets, ${totalBytes} B total).`,
);
