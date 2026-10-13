import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { privacyLocked, subscribePrivacyLock } from "../preferences/lockState";
import { useTradingData } from "./useTradingData";
import { preferredChartInterval } from "./LiveChart";
import { connectWalletData, forgetWalletDataAccess, getAccount, hasWalletDataAccess, watchPrivateFeed, type OpenOrder } from "./service";
import { pendingWalletData } from "./readAccess";
import { errorText } from "../utils/errorText";
import { notify } from "../notifications/store";
import { androidPush } from "../notifications/pushService";
import { AutomaticAlerts } from "../notifications/AutomaticAlerts";

function useSessionData(address: string) {
  const locked = useSyncExternalStore(subscribePrivacyLock, privacyLocked);
  const [started, setStarted] = useState(false);
  useEffect(() => { if (!privacyLocked()) setStarted(true); }, [locked]);
  const [marketId, setMarketId] = useState(16);
  const [resolution, setResolution] = useState(preferredChartInterval);
  const data = useTradingData(address, marketId, resolution, started);
  const [walletData, setWalletData] = useState<boolean | null>(null);
  const [walletDataBusy, setWalletDataBusy] = useState(false);
  const [walletDataError, setWalletDataError] = useState("");
  const [privateStatus, setPrivateStatus] = useState("connecting");
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [forwardingAllowed, setForwardingAllowed] = useState<boolean | null>(null);
  const alive = useRef(true), working = useRef(false), attempted = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const connectData = useCallback(async () => {
    if (working.current || privacyLocked() || document.hidden) return;
    working.current = true; attempted.current = true;
    setWalletDataBusy(true); setWalletDataError("");
    try {
      await connectWalletData(address);
      if (alive.current) setWalletData(true);
    } catch (error) { if (alive.current) setWalletDataError(errorText(error)); }
    finally { working.current = false; if (alive.current) setWalletDataBusy(false); }
  }, [address]);
  useEffect(() => {
    if (!started) return;
    let active = true;
    void (async () => {
      await pendingWalletData(address)?.catch(() => {});
      const ready = await hasWalletDataAccess(address);
      if (active) setWalletData(ready);
    })().catch(error => { if (active) { setWalletData(false); setWalletDataError(errorText(error)); } });
    return () => { active = false; };
  }, [address, started]);
  useEffect(() => {
    if (started && !locked && data.account?.exists && walletData === false && !attempted.current) void connectData();
  }, [started, locked, data.account?.exists, walletData, connectData]);
  const resetDataAccess = useCallback(async () => {
    await forgetWalletDataAccess(address);
    setWalletData(false); setOpenOrders([]);
    await connectData();
  }, [address, connectData]);
  useEffect(() => {
    if (!started || !walletData) return;
    let active = true;
    let stop: (() => void) | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    void watchPrivateFeed(address, event => {
      if (!active) return;
      if (event.type === "status") {
        setPrivateStatus(event.state);
        setWalletDataError(event.state === "reconnecting" ? errorText(event.message ?? "Reconnecting wallet data…") : "");
      } else if (event.type === "orders") setOpenOrders(event.orders);
      else if (event.type === "forwarding") setForwardingAllowed(event.allowed);
      else if (event.type === "accountChanged") {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => { void getAccount(address).then(value => { if (active) data.setAccount(value); }).catch(() => {}); }, 900);
      }
    }).then(cleanup => { if (active) stop = cleanup; else cleanup(); })
      .catch(error => { if (active) setWalletDataError(errorText(error)); });
    return () => { active = false; if (refreshTimer) clearTimeout(refreshTimer); stop?.(); };
  }, [address, started, walletData, data.setAccount]);
  useEffect(() => {
    if (!started) return;
    let active = true, stop: (() => void) | undefined;
    void listen<{message: string}>("perpl-trade-notification", event => {
      if (active && !privacyLocked() && !document.hidden) notify({kind: "info", message: errorText(event.payload.message)});
    }).then(cleanup => { if (active) stop = cleanup; else cleanup(); });
    return () => { active = false; stop?.(); };
  }, [started]);
  useEffect(() => {
    if (!started || !androidPush()) return;
    const keepAlive = () => { if (!document.hidden) void invoke("plugin:exora|set_live_session", {enabled: true}).catch(() => {}); };
    keepAlive(); document.addEventListener("visibilitychange", keepAlive);
    return () => { document.removeEventListener("visibilitychange", keepAlive); void invoke("plugin:exora|set_live_session", {enabled: false}).catch(() => {}); };
  }, [started]);
  return {...data, marketId, setMarketId, resolution, setResolution, walletData, walletDataBusy, walletDataError, setWalletDataError,
    privateStatus, openOrders, forwardingAllowed, setForwardingAllowed, connectData, resetDataAccess};
}
const Context = createContext<ReturnType<typeof useSessionData> | null>(null);
export function TradingSession({address, children}: {address: string; children: ReactNode}) {
  const data = useSessionData(address);
  return <Context.Provider value={data}><AutomaticAlerts address={address} accountReady={!!data.account?.exists && !!data.walletData} />{children}</Context.Provider>;
}
export function useTradingSession() {
  const session = useContext(Context);
  if (!session) throw new Error("Trading requires an unlocked EXORA session.");
  return session;
}
