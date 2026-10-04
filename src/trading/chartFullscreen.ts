import { isTauri, invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

type LockableOrientation = ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
/** Android uses real orientation changes, so canvas hit testing and pinch gestures remain accurate. */
export function useChartFullscreen() {
  const [fullscreen, setFullscreen] = useState(false);
  const active = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const nativeQueue = useRef(Promise.resolve());
  const native = (enabled: boolean) => {
    nativeQueue.current = nativeQueue.current.catch(() => {}).then(async () => {
      if (isTauri()) await invoke("plugin:exora|set_chart_fullscreen", {enabled});
    }).catch(() => { /* The responsive fullscreen layout remains usable on unsupported platforms. */ });
  };
  const restore = () => {
    if (!active.current) return;
    active.current = false;
    native(false);
    try { screen.orientation?.unlock(); } catch { /* Optional browser API. */ }
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    previousFocus.current?.focus();
  };
  const close = (after?: () => void) => {
    restore(); setFullscreen(false);
    if (history.state?.exoraChartFullscreen) {
      if (after) window.addEventListener("popstate", after, {once:true});
      history.back();
    } else after?.();
  };
  const open = (element: HTMLElement | null) => {
    if (active.current) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    active.current = true; setFullscreen(true);
    history.pushState({...history.state, exoraChartFullscreen: true}, "");
    native(true);
    if (!isTauri() && element?.requestFullscreen) {
      void element.requestFullscreen().then(async () => {
        if (!active.current) { if (document.fullscreenElement) await document.exitFullscreen(); return; }
        await (screen.orientation as LockableOrientation)?.lock?.("landscape");
      }).catch(() => {});
    }
  };
  useEffect(() => {
    const back = () => { if (active.current) { restore(); setFullscreen(false); } };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && active.current) { event.preventDefault(); close(); } };
    const exited = () => { if (!document.fullscreenElement && active.current) close(); };
    window.addEventListener("popstate", back);
    window.addEventListener("keydown", escape);
    document.addEventListener("fullscreenchange", exited);
    return () => {
      window.removeEventListener("popstate", back); window.removeEventListener("keydown", escape);
      document.removeEventListener("fullscreenchange", exited);
      const wasActive = active.current; restore();
      if (wasActive && history.state?.exoraChartFullscreen) history.back();
    };
  }, []);
  useEffect(() => {
    if (!fullscreen) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, [fullscreen]);
  return {fullscreen, open, close};
}
