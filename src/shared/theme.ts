import type { AnimationPreference, ThemePreference } from "./types";

export function applyTheme(theme: ThemePreference): void {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

export function applyAnimationPreference(preference: AnimationPreference): void {
  if (preference === "system") {
    document.documentElement.removeAttribute("data-motion");
  } else {
    document.documentElement.dataset.motion = preference;
  }
}
