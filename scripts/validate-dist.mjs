import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("dist");
const manifestPath = resolve(root, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (manifest.manifest_version !== 3) throw new Error("Build must use Manifest V3");
if (!manifest.background?.service_worker) throw new Error("Background service worker is missing");
if (!manifest.action?.default_popup) throw new Error("Popup entry is missing");
if (manifest.host_permissions?.length) {
  throw new Error("Install-time host access is not allowed; use optional_host_permissions");
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
  await access(resolve(root, relativePath));
}

const backgroundSize = (await stat(resolve(root, manifest.background.service_worker))).size;
const contentSize = (await stat(resolve(root, "content.js"))).size;
if (backgroundSize === 0 || contentSize === 0) throw new Error("Extension runtime bundle is empty");

console.log(`Validated Manifest V3 build (${required.length} referenced assets).`);
