import { useEffect } from "react";

export function usePageVisibilityLifecycle(): void {
  useEffect(() => {
    const sync = () => {
      document.documentElement.toggleAttribute(
        "data-page-hidden",
        document.visibilityState !== "visible",
      );
    };
    sync();
    document.addEventListener("visibilitychange", sync, { passive: true });
    return () => {
      document.removeEventListener("visibilitychange", sync);
      document.documentElement.removeAttribute("data-page-hidden");
    };
  }, []);
}
