import { watch } from "node:fs";
import { spawn } from "node:child_process";

const targets = ["src", "public", "popup.html", "options.html", "onboarding.html"];
let building = false;
let queued = false;
let debounce;

function build() {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(command, ["run", "build"], { stdio: "inherit" });
  child.on("exit", () => {
    building = false;
    if (queued) {
      queued = false;
      build();
    }
  });
}

build();
for (const target of targets) {
  watch(target, { recursive: true }, () => {
    clearTimeout(debounce);
    debounce = setTimeout(build, 180);
  });
}

console.log("Watching BlinkBreak. Reload the unpacked extension after each successful build.");
