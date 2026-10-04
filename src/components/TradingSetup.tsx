import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Outlet, useNavigate } from "react-router";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowRightIcon, CheckIcon, CopyIcon, ExternalLinkIcon, Layers3Icon, RotateCwIcon } from "lucide-react";
import { Sheet } from "./TransferPrimitives";
import { useSessionAddress } from "../utils/authSession";
import { errorText } from "../utils/errorText";
import { notify } from "../notifications/store";

type SetupStatus = { exists: boolean; hasMon: boolean; hasAusd: boolean; minimumOpen: string | null };
type SetupContext = {
  status: SetupStatus | null;
  error: string;
  openSetup: () => void;
  refresh: () => Promise<void>;
  accountCreated: () => void;
};
const Context = createContext<SetupContext | null>(null);
export function useTradingSetup() {
  const value = useContext(Context);
  if (!value) throw new Error("Trading setup requires a signed-in session");
  return value;
}

export function TradingSetupProvider() {
  const address = useSessionAddress();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const prompted = useRef(false);
  const completed = useRef(false);
  const refresh = useCallback(async () => {
    if (!address || inFlight.current || completed.current) return;
    inFlight.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await invoke<SetupStatus>("get_perpl_setup", { address });
      if (!mounted.current || completed.current) return;
      setStatus(result);
      if (result.exists) {
        completed.current = true;
        setOpen(false);
      } else if (!prompted.current) {
        prompted.current = true;
        setOpen(true);
      }
    } catch (cause) {
      if (mounted.current && !completed.current) setError(errorText(cause));
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [address]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);
  useEffect(() => {
    // Refresh after returning from the MON faucet; no background polling.
    const onReturn = () => {
      if (document.visibilityState === "visible" && prompted.current) void refresh();
    };
    document.addEventListener("visibilitychange", onReturn);
    return () => document.removeEventListener("visibilitychange", onReturn);
  }, [refresh]);
  const accountCreated = useCallback(() => {
    completed.current = true;
    setStatus({ exists: true, hasMon: false, hasAusd: false, minimumOpen: null });
    setError("");
    setOpen(false);
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.getElementById("trading-setup-title")?.closest<HTMLElement>('[role="dialog"]');
    const controls = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? []);
    controls()[0]?.focus({ preventScroll: true });
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialog?.addEventListener("keydown", trapFocus);
    return () => { dialog?.removeEventListener("keydown", trapFocus); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [open]);
  const openSetup = useCallback(() => { prompted.current = true; setOpen(true); void refresh(); }, [refresh]);
  const goTo = (path: string, setupAction: string) => {
    setOpen(false);
    navigate(path, { state: { setupAction } });
  };
  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      notify({ kind: "success", title: "Wallet address copied", message: "Paste it into the Monad faucet to receive testnet MON." });
    } catch { notify({ kind: "error", message: "Could not copy your address. Please try again." }); }
  };
  const minimum = status?.minimumOpen ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(Number(status.minimumOpen)) : "—";
  const canClaim = !!status?.hasMon && !loading && !error;
  const canCreate = canClaim && !!status?.hasAusd;
  const actionClass = "mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#b9a4ff]/25 bg-[#b9a4ff]/10 px-3 py-2 text-xs font-medium text-[#d5c7ff] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[#b9a4ff]";
  return <Context.Provider value={{ status, error, openSetup, refresh, accountCreated }}>
    <div inert={open || undefined}><Outlet /></div>
    <Sheet open={open} onClose={() => setOpen(false)} eyebrow="Welcome to trading" labelledBy="trading-setup-title" viewKey="trading-setup">
      <h2 id="trading-setup-title" className="text-2xl font-semibold">Before your first trade</h2>
      <p className="mt-2 text-sm leading-relaxed text-[#b9b0c9]">Your Exora wallet is ready. Complete these steps on Monad testnet to start trading.</p>
      <ol className="mt-5 space-y-3">
        {[
          { title: "Get testnet MON", done: !!status?.hasMon, body: "MON pays network fees, including the AUSD faucet claim. Send it to this Exora wallet.", action: <>
            <button type="button" onClick={() => void copyAddress()} className={actionClass}><CopyIcon className="h-3.5 w-3.5" />Copy wallet address</button>
            <a href="https://faucet.monad.xyz/" target="_blank" rel="noopener noreferrer" draggable={false} className={actionClass} onClick={event => {
              if (!isTauri()) return;
              event.preventDefault();
              void openUrl(event.currentTarget.href).catch(() => notify({ kind: "error", message: "Could not open the faucet. Visit faucet.monad.xyz in your browser." }));
            }}>Open Monad faucet<ExternalLinkIcon className="h-3.5 w-3.5" /></a>
            <p className="mt-2 text-[11px] leading-relaxed text-[#9489a7]">Keep some MON for future transactions. Each fee is checked before signing.</p>
          </> },
          { title: "Claim testnet AUSD", done: !!status?.hasAusd, body: `Use Get testnet faucet on Home.${status?.minimumOpen ? ` You need at least ${minimum} AUSD for your initial Perpl deposit.` : " We’ll check the minimum initial deposit when your wallet connects."}`, action: <>
            <button type="button" disabled={!canClaim} onClick={() => goTo("/home", "faucet")} className={actionClass}>Go to AUSD faucet<ArrowRightIcon className="h-3.5 w-3.5" /></button>
            {status && !status.hasMon && <p className="mt-2 text-[11px] text-[#c4b2ef]">Get MON first, then refresh this checklist.</p>}
          </> },
          { title: "Create & fund your Perpl account", done: !!status?.exists, body: "Deposit AUSD from your wallet into Perpl. Approve AUSD first, then confirm account creation with your passkey. After confirmation, you can trade.", action: <>
            <button type="button" disabled={!canCreate} onClick={() => goTo("/portfolio", "createAccount")} className={actionClass}>Create Perpl account<ArrowRightIcon className="h-3.5 w-3.5" /></button>
            {status && !status.hasAusd && <p className="mt-2 text-[11px] text-[#c4b2ef]">Claim enough AUSD before creating your account.</p>}
          </> },
        ].map((step, index) => <li key={step.title} className="flex gap-3 rounded-2xl border border-[#b9a4ff]/15 bg-white/[0.025] p-4">
          <span aria-label={step.done ? "Complete" : `Step ${index + 1}`} className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs ${step.done ? "bg-[#71f7b5]/15 text-[#71f7b5]" : "bg-[#8873ff]/20 text-[#cdbdff]"}`}>{step.done ? <CheckIcon className="h-3.5 w-3.5" /> : index + 1}</span>
          <div className="min-w-0 flex-1"><h3 className="text-sm font-medium">{step.title}</h3><p className="mt-1.5 text-xs leading-relaxed text-[#b9b0c9]">{step.body}</p>{step.action}</div>
        </li>)}
      </ol>
      {error && <p role="alert" className="mt-4 text-xs leading-relaxed text-[#ff9fae]">{error} Your setup progress could not be verified.</p>}
      <button type="button" disabled={loading} onClick={() => void refresh()} className={actionClass}><span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] border border-[#d5c7ff]/20 bg-linear-to-br from-[#c2adff]/20 to-[#100d1c] shadow-[inset_0_1px_0_rgba(241,234,255,0.16)]"><RotateCwIcon strokeWidth={1.4} className={`h-3.5 w-3.5 text-[#d8ccf5] ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} /></span>{loading ? "Checking your wallet…" : "Refresh setup progress"}</button>
      <button type="button" onClick={() => setOpen(false)} className="mt-3 min-h-10 w-full text-xs text-[#b9b0c9]">I’ll do this later</button>
    </Sheet>
  </Context.Provider>;
}

export function TradingSetupBanner() {
  const { status, error, openSetup } = useTradingSetup();
  if (status?.exists || (!status && !error)) return null;
  return <button type="button" onClick={openSetup} className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-[#b9a4ff]/25 bg-[#8873ff]/10 p-4 text-left text-[#eee6ff]">
    <span aria-hidden="true" className="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-[14px] border border-[#d5c7ff]/20 bg-linear-to-br from-[#c2adff]/20 via-[#8873ff]/10 to-[#100d1c] shadow-[inset_0_1px_0_rgba(241,234,255,0.16),0_4px_14px_rgba(0,0,0,0.2)]">
      <span className="absolute inset-x-2 top-0 h-px bg-linear-to-r from-transparent via-[#e0d4ff]/60 to-transparent" />
      <Layers3Icon strokeWidth={1.4} className="h-[22px] w-[22px] text-[#d8ccf5]" />
    </span>
    <span className="flex-1"><span className="block text-sm font-medium">{status ? "Finish your trading setup" : "Check your trading setup"}</span><span className="mt-1 block text-xs text-[#b9b0c9]">{status ? "MON for fees → AUSD faucet → Perpl account" : "Couldn’t check your account. Tap to retry."}</span></span>
    <ArrowRightIcon className="h-4 w-4 shrink-0 text-[#b9a4ff]" />
  </button>;
}
