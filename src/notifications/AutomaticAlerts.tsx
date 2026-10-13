import { systemPromptActive, withSystemPrompt } from "../preferences/systemPrompt";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { androidPush, configurePush, getPushStatus } from "./pushService";
import { privacyLocked, subscribePrivacyLock } from "../preferences/lockState";

// Saved changes wake the existing session worker; screens never own a connection.
export function requestAlertSync() {
  window.dispatchEvent(new Event("exora-alert-sync-requested"));
}
export function AutomaticAlerts({address, accountReady}: {address: string; accountReady: boolean}) {
  const locked = useSyncExternalStore(subscribePrivacyLock, privacyLocked);
  const ready = useRef(accountReady); ready.current = accountReady;
  const wake = useRef(() => {});
  useEffect(() => {
    if (!androidPush()) return;
    let active = true, busy = false, pending = false, lastAttempt = 0, permissionAsked = false, bound = false;
    const current = () => active;
    const sync = async (force = false) => {
      if (busy) { if (force) pending = true; return; }
      if (!current() || systemPromptActive() || document.hidden || privacyLocked() || (!force && Date.now() - lastAttempt < 60_000)) return;
      busy = true; lastAttempt = Date.now();
      try {
        const native = await getPushStatus();
        if (!current() || !native.configured) return;
        if (!await isPermissionGranted()) {
          if (permissionAsked) return;
          permissionAsked = true;
          if (await withSystemPrompt(requestPermission) !== "granted" || !current()) return;
        }
        if (!native.enabled || !bound) { await configurePush(true, address); bound = true; }
        if (!current()) return;
        const remote = await invoke<{connected: boolean; accountConnected: boolean}>("remote_alert_status", {address});
        if (!current()) return;
        if (!remote.connected) await invoke("connect_remote_alerts", {address});
        else await invoke("sync_remote_alerts", {address});
        if (current() && ready.current && !remote.accountConnected) await invoke("enable_remote_account_alerts", {address});
      } catch {
        // Keep saved changes queued; retry automatically online or on the timer.
      } finally {
        busy = false;
        if (active && pending) { pending = false; void sync(true); }
      }
    };
    wake.current = () => { void sync(true); };
    const resume = () => { void sync(); };
    const retry = () => { void sync(true); };
    const timer = window.setInterval(resume, 60_000);
    window.addEventListener("online", retry);
    window.addEventListener("exora-system-prompt-finished", retry);
    window.addEventListener("exora-alert-sync-requested", retry);
    document.addEventListener("visibilitychange", resume);
    void sync();
    return () => { active = false; wake.current = () => {}; clearInterval(timer); window.removeEventListener("online", retry); window.removeEventListener("exora-system-prompt-finished", retry); window.removeEventListener("exora-alert-sync-requested", retry); document.removeEventListener("visibilitychange", resume); };
  }, [address]);
  useEffect(() => { if (!locked) wake.current(); }, [locked, accountReady]);
  return null;
}
