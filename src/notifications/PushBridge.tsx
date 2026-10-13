import { useEffect, useRef, useSyncExternalStore } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useNavigate } from "react-router";
import { useSessionAddress } from "../utils/authSession";
import { privacyLocked, subscribePrivacyLock } from "../preferences/lockState";
import { androidPush } from "./pushService";
import { notify } from "./store";

type Notice = { title: string; body: string; screen: string; marketId: number | null; tapped: boolean };

export function PushBridge() {
  const address = useSessionAddress();
  const locked = useSyncExternalStore(subscribePrivacyLock, privacyLocked);
  const navigate = useNavigate();
  const queue = useRef<Notice[]>([]);
  const wakeBridge = useRef(() => {});
  const activeAddress = useRef(address);
  activeAddress.current = address;
  const flush = useRef(() => {});
  flush.current = () => {
    if (!activeAddress.current || privacyLocked() || document.hidden) return;
    for (const item of queue.current.splice(0)) {
      const recipient = activeAddress.current;
      const open = () => {
        if (!recipient || activeAddress.current !== recipient || privacyLocked()) return;
        const screen = ["trade", "portfolio", "activity"].includes(item.screen) ? item.screen : "alerts";
        navigate(`/${screen}`, { state: { marketId: item.marketId ?? undefined } });
      };
      if (item.tapped) open();
      else notify({ kind: "info", title: item.title, message: item.body, action: { label: "View", run: open } });
    }
  };
  useEffect(() => { queue.current = []; }, [address]);
  useEffect(() => { flush.current(); }, [locked]);
  useEffect(() => {
    if (!androidPush()) return;
    let disposed = false;
    let listening = false;
    let draining = false;
    let again = false;
    let stop: (() => void) | undefined;
    const drain = async () => {
      if (disposed || !listening || !activeAddress.current || privacyLocked() || document.hidden) return;
      if (draining) { again = true; return; }
      draining = true;
      try { await invoke("drain_push_inbox"); } catch { /* Retry when the app resumes or another message arrives. */ }
      finally { draining = false; if (again) { again = false; void drain(); } }
    };
    const wake = () => { flush.current(); void drain(); };
    wakeBridge.current = wake;
    const channel = new Channel<unknown>(wake);
    void (async () => {
      stop = await listen<Notice>("exora-push", ({ payload }) => {
        if (disposed || !activeAddress.current) return;
        queue.current = [...queue.current, payload].slice(-20);
        flush.current();
      });
      if (disposed) { stop(); return; }
      await invoke("plugin:exora|watch_push", { handler: channel });
      if (disposed) { await invoke("plugin:exora|unwatch_push", { channelId: channel.id }); return; }
      listening = true;
      wake();
    })().catch(() => {});
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("exora-session-changed", wake);
    const unlock = subscribePrivacyLock(wake);
    return () => {
      disposed = true; wakeBridge.current = () => {}; stop?.(); unlock();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("exora-session-changed", wake);
      if (listening) void invoke("plugin:exora|unwatch_push", { channelId: channel.id }).catch(() => {});
    };
  }, []);
  // The session event fires before React renders the new address.
  useEffect(() => { if (address && !locked) wakeBridge.current(); }, [address, locked]);
  return null;
}
