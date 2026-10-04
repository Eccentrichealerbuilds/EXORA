import { notify } from "../notifications/store";
import { useEffect, useRef, useState, type TouchEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRightIcon, ArrowUpRightIcon, ChevronDownIcon, CloudOffIcon, CopyIcon, FingerprintIcon, LogOutIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import ausdCardArt from "../assets/cards/ausd-card.webp";
import ausdCardBase from "../assets/cards/ausd-card-base.webp";
import ausdCardEmblem from "../assets/cards/ausd-card-emblem.webp";
import monCardArt from "../assets/cards/mon-card.webp";
import monCardBase from "../assets/cards/mon-card-base.webp";
import monCardEmblem from "../assets/cards/mon-card-emblem.webp";
import faucetGatewayArt from "../assets/panels/faucet-gateway.webp";
import marketHeaderArt from "../assets/panels/market-header.webp";
import marketCellArt from "../assets/panels/market-cell.webp";
import { InteractiveTokenCard } from "../components/InteractiveTokenCard";
import { AppTabs } from "../components/AppTabs";
import { PasskeySheet } from "../components/PasskeySheet";
import { TransferSheet } from "../components/TransferSheet";
import { FaucetSheet } from "../components/FaucetSheet";
import { getWalletBalances, type Asset, type WalletBalances } from "../transactions/wallet";
import { chooseFromExistingPasskey } from "../utils/getCredentials.ts";
import { loadPublicAccount } from "../utils/storageSaveAndLoad.ts";
import { signOut, startSession } from "../utils/authSession";
import { formatBalance } from "../utils/formatBalance.ts";
import { errorText } from "../utils/errorText";
import { usePrices } from "../websocket/usePrices.ts";
import type { PriceUpdate } from "../types.ts";

type HomeRouteState = {
      sortedPrices?: PriceUpdate[];
};

const FEATURED = [
      { symbol: "AUSD", name: "Agora USD", color: "#5ec8ff", still: ausdCardArt, base: ausdCardBase, emblem: ausdCardEmblem },
      { symbol: "MON", name: "Monad", color: "#8873ff", still: monCardArt, base: monCardBase, emblem: monCardEmblem },
] as const;

function decimalUnits(value: string, decimals: number) {
      const [whole, fraction = ""] = value.split(".");
      if (!/^\d+$/.test(whole) || (fraction && !/^\d+$/.test(fraction))) return null;
      return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.slice(0, decimals).padEnd(decimals, "0") || "0");
}

function displayUsd(cents: bigint) {
      const dollars = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return `$${dollars}.${(cents % 100n).toString().padStart(2, "0")}`;
}

const TOKEN_META: Record<string, { name: string; color: string }> = {
      BTC: { name: "Bitcoin", color: "#ffb547" },
      ETH: { name: "Ethereum", color: "#d6d0e6" },
      SOL: { name: "Solana", color: "#71f7b5" },
      MON: { name: "Mon", color: "#8873ff" },
      AUSD: { name: "Agora USD", color: "#5ec8ff" },
      USDC: { name: "USD Coin", color: "#4f8dff" },
      USDT: { name: "Tether USD", color: "#71f7b5" },
};

function BrandMark() {
      return (
            <div className="flex items-center gap-3" aria-label="Exora">
                  <span className="relative inline-block h-[18px] w-[18px] rotate-45 rounded-[5px] bg-[#8873ff]" aria-hidden="true">
                        <span className="absolute inset-[5px] rounded-[2px] bg-[#09070d]" />
                  </span>
                  <span className="font-display text-sm font-bold tracking-[0.22em]">EXORA</span>
            </div>
      );
}

function TokenGlyph({ glyph, color }: { glyph: string; color: string }) {
      return (
            <span className="relative grid h-10 w-10 shrink-0 place-items-center" aria-hidden="true">
                  <span className="absolute h-7 w-7 rotate-45 rounded-[9px]" style={{ backgroundColor: color }} />
                  <span className="relative font-display text-xs font-bold text-[#0a0710]">{glyph}</span>
            </span>
      );
}

interface AccountMenuProps {
      address: string | null;
      onCreatePasskey: () => void;
      onSwitchPasskey: () => Promise<void>;
      onSignOut: () => void;
}

function AccountMenu({ address, onCreatePasskey, onSwitchPasskey, onSignOut }: AccountMenuProps) {
      const [open, setOpen] = useState(false);
      const [copied, setCopied] = useState(false);
      const [switching, setSwitching] = useState(false);
      const [switchError, setSwitchError] = useState(false);
      const rootRef = useRef<HTMLDivElement>(null);

      useEffect(() => {
            if (!open) return;
            const onPointerDown = (event: PointerEvent) => {
                  if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
            };
            document.addEventListener("pointerdown", onPointerDown);
            return () => document.removeEventListener("pointerdown", onPointerDown);
      }, [open]);

      useEffect(() => {
            setCopied(false);
            setSwitchError(false);
      }, [address]);

      const copyAddress = async () => {
            if (!address) return;
            try {
                  await navigator.clipboard.writeText(address);
                  setCopied(true);
                  notify({ title: "Address copied", message: "Your wallet address is on the clipboard." });
            } catch {
                  setCopied(false);
                  notify({ kind: "error", title: "Could not copy", message: "Try copying your wallet address again." });
            }
      };

      const shortAddress = address ? `${address.slice(0, 8)}…${address.slice(-6)}` : "No address available";

      const switchPasskey = async () => {
            if (switching) return;
            setSwitching(true);
            setSwitchError(false);
            try {
                  await onSwitchPasskey();
                  setOpen(false);
            } catch {
                  setSwitchError(true);
            } finally {
                  setSwitching(false);
            }
      };

      return (
            <div ref={rootRef} className="relative">
                  <button
                        type="button"
                        onClick={() => setOpen((value) => !value)}
                        aria-expanded={open}
                        aria-label="Account menu"
                        className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#9b87ff] ${open ? "border-[rgba(136,115,255,0.6)] bg-[rgba(136,115,255,0.12)]" : "border-[rgba(230,224,255,0.14)] bg-[rgba(255,255,255,0.03)] hover:border-[rgba(230,224,255,0.3)]"}`}
                  >
                        <span className="relative grid h-6 w-6 shrink-0 place-items-center" aria-hidden="true">
                              <span className="absolute h-[18px] w-[18px] rotate-45 rounded-[5px] bg-[#8873ff]" />
                              <span className="relative font-display text-[10px] font-bold uppercase text-[#0a0710]">{address?.[2]?.toUpperCase() ?? "E"}</span>
                        </span>
                        <span className="max-w-[110px] truncate font-mono text-[11px] text-[#e7e1f3]" title={address ?? undefined}>{shortAddress}</span>
                        <ChevronDownIcon className={`h-3.5 w-3.5 text-[#a59db3] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                  <AnimatePresence>
                        {open && (
                              <motion.div
                                    role="dialog"
                                    aria-label="Your account"
                                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -6, scale: 0.97 }}
                                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                                    className="absolute right-0 top-[calc(100%+10px)] z-30 w-[min(340px,calc(100vw-32px))] origin-top-right rounded-[22px] border border-[rgba(230,224,255,0.16)] bg-[#0b0912] p-2 shadow-[0_24px_70px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.08)]"
                              >
                                    <div className="rounded-[16px] border border-[rgba(136,115,255,0.3)] bg-[rgba(136,115,255,0.08)] p-3">
                                          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#a59db3]">Wallet address</p>
                                          <p className="mt-1 break-all font-mono text-[11px] text-[#f7f4ff]">{address ?? "No address available"}</p>
                                          <button
                                                type="button"
                                                onClick={() => { void copyAddress(); }}
                                                disabled={!address}
                                                className="mt-3 flex w-full items-center justify-between rounded-[10px] border border-[rgba(230,224,255,0.1)] bg-[rgba(5,4,7,0.5)] px-3 py-2 font-mono text-[11px] text-[#cfc7dc] outline-none hover:border-[rgba(230,224,255,0.28)] focus-visible:ring-2 focus-visible:ring-[#9b87ff] disabled:cursor-not-allowed"
                                          >
                                                <span>{shortAddress}</span>
                                                <span className="flex items-center gap-1.5 text-[10px] text-[#a59db3]">
                                                      <CopyIcon className="h-3.5 w-3.5" aria-hidden="true" />
                                                      {copied ? "Copied" : "Copy"}
                                                </span>
                                          </button>
                                    </div>
                                    <button
                                          type="button"
                                          onClick={() => { void switchPasskey(); }}
                                          disabled={switching}
                                          className="group mt-2 flex w-full items-center gap-3 rounded-[16px] border border-[rgba(230,224,255,0.12)] px-3 py-3 text-left outline-none transition-colors hover:border-[rgba(136,115,255,0.5)] hover:bg-[rgba(136,115,255,0.06)] focus-visible:ring-2 focus-visible:ring-[#9b87ff] disabled:cursor-wait disabled:opacity-60"
                                    >
                                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-[rgba(136,115,255,0.14)]">
                                                <FingerprintIcon className="h-[18px] w-[18px] text-[#b8a9ff]" aria-hidden="true" />
                                          </span>
                                          <span className="min-w-0 flex-1">
                                                <span className="block font-display text-sm font-semibold text-[#f1ecff]">{switching ? "Choosing passkey…" : "Sign in with another passkey"}</span>
                                                <span className="block font-mono text-[10px] text-[#8f879c]">Verify with your device or security key</span>
                                          </span>
                                          <ArrowRightIcon className="h-4 w-4 text-[#8f879c] transition-transform group-hover:translate-x-0.5 group-hover:text-[#f1ecff]" aria-hidden="true" />
                                    </button>
                                    {switchError && <p role="alert" className="px-3 pt-2 font-mono text-[10px] text-[#ff8ea6]">Could not switch passkeys. Please try again.</p>}
                                    <div className="mt-2 border-t border-[rgba(230,224,255,0.08)] pt-2">
                                    <button
                                          type="button"
                                          onClick={() => { setOpen(false); onCreatePasskey(); }}
                                          className="flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left font-display text-sm font-semibold text-[#e7e1f3] outline-none transition-colors hover:bg-[rgba(255,255,255,0.04)] focus-visible:ring-2 focus-visible:ring-[#9b87ff]"
                                    >
                                          <span className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-[rgba(136,115,255,0.6)]">
                                                <PlusIcon className="h-3.5 w-3.5 text-[#b8a9ff]" aria-hidden="true" />
                                          </span>
                                          Create new passkey
                                    </button>
                                    <button
                                          type="button"
                                          onClick={() => { setOpen(false); onSignOut(); }}
                                          className="flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left font-display text-sm font-semibold text-[#ff8ea6] outline-none transition-colors hover:bg-[rgba(255,113,142,0.06)] focus-visible:ring-2 focus-visible:ring-[#ff718e]"
                                    >
                                          <span className="grid h-6 w-6 place-items-center"><LogOutIcon className="h-4 w-4" aria-hidden="true" /></span>
                                          Sign out
                                    </button>
                                    </div>
                              </motion.div>
                        )}
                  </AnimatePresence>
            </div>
      );
}

export default function Home() {
      const navigate = useNavigate();
      const location = useLocation();
      const routeState = location.state as HomeRouteState | null;
      const [address, setAddress] = useState<string | null>(() => loadPublicAccount()?.address ?? null);
      const addressRef = useRef(address);
      addressRef.current = address;
      const [createPasskeyOpen, setCreatePasskeyOpen] = useState(false);
      const [transferToken, setTransferToken] = useState<Asset>("AUSD");
      const [transferOpen, setTransferOpen] = useState(false);
      const [faucetOpen, setFaucetOpen] = useState(false);
      const [balances, setBalances] = useState<WalletBalances | null>(null);
      const [balanceError, setBalanceError] = useState("");
      const [balanceLoading, setBalanceLoading] = useState(false);
      const balanceRequestId = useRef(0);
      const pullStartY = useRef<number | null>(null);
      const pullDistanceRef = useRef(0);
      const [pullDistance, setPullDistance] = useState(0);
      const { prices, status } = usePrices();
      useEffect(() => {
            const requestId = ++balanceRequestId.current;
            if (!address) { setBalances(null); setBalanceError(""); setBalanceLoading(false); return; }
            let active = true;
            setBalances(null);
            setBalanceError("");
            setBalanceLoading(true);
            getWalletBalances(address).then((result) => {
                  if (active && balanceRequestId.current === requestId) setBalances(result);
            }).catch((error: unknown) => {
                  if (active && balanceRequestId.current === requestId) setBalanceError(errorText(error));
            }).finally(() => { if (active && balanceRequestId.current === requestId) setBalanceLoading(false); });
            return () => { active = false; };
      }, [address]);
      const refreshBalances = () => {
            if (!address) return;
            const requestedAddress = address;
            const requestId = ++balanceRequestId.current;
            setBalanceError("");
            setBalanceLoading(true);
            getWalletBalances(requestedAddress).then((result) => {
                  if (addressRef.current === requestedAddress && balanceRequestId.current === requestId) setBalances(result);
            }).catch((error: unknown) => {
                  if (addressRef.current === requestedAddress && balanceRequestId.current === requestId) setBalanceError(errorText(error));
            }).finally(() => {
                  if (addressRef.current === requestedAddress && balanceRequestId.current === requestId) setBalanceLoading(false);
            });
      };
      const setPull = (distance: number) => {
            pullDistanceRef.current = distance;
            setPullDistance(distance);
      };
      const onPullStart = (event: TouchEvent<HTMLElement>) => {
            if (!address || balanceLoading || createPasskeyOpen || transferOpen || faucetOpen || window.scrollY > 1 || event.touches.length !== 1 || (event.target as HTMLElement).closest('[role="dialog"], input, textarea')) return;
            pullStartY.current = event.touches[0].clientY;
      };
      const onPullMove = (event: TouchEvent<HTMLElement>) => {
            if (pullStartY.current === null) return;
            if (event.touches.length !== 1) { pullStartY.current = null; setPull(0); return; }
            if (window.scrollY > 1) { pullStartY.current = null; setPull(0); return; }
            const moved = event.touches[0].clientY - pullStartY.current;
            setPull(moved > 0 ? Math.min(88, moved * 0.55) : 0);
      };
      const onPullEnd = () => {
            if (pullStartY.current !== null && pullDistanceRef.current >= 64 && !balanceLoading) refreshBalances();
            pullStartY.current = null;
            setPull(0);
      };
      const onPullCancel = () => {
            pullStartY.current = null;
            setPull(0);
      };
      const pricesById = new Map<number, PriceUpdate>();
      for (const price of routeState?.sortedPrices ?? []) pricesById.set(price.marketId, price);
      for (const price of Object.values(prices)) pricesById.set(price.marketId, price);
      const sortedPrices = Array.from(pricesById.values()).sort(
            (left, right) => left.marketId - right.marketId,
      );
      const monMarket = sortedPrices.find((price) => price.symbol.toUpperCase() === "MON");
      const monPriceMicro = monMarket ? decimalUnits(monMarket.price.replace(/[$,]/g, ""), 6) : null;
      const ausdCents = balances ? (decimalUnits(balances.ausd, 6) ?? 0n) / 10_000n : null;
      const monUnits = balances ? decimalUnits(balances.mon, 18) : null;
      const monCents = monUnits === 0n ? 0n : monUnits !== null && monPriceMicro !== null
            ? monUnits * monPriceMicro / 10n ** 22n : null;
      const estimatedTotal = ausdCents !== null && monCents !== null ? displayUsd(ausdCents + monCents) : null;


      const switchPasskey = async () => {
            await chooseFromExistingPasskey();
            const account = loadPublicAccount();
            if (!account) throw new Error("Sign-in did not return a wallet.");
            startSession(account.address);
            setAddress(loadPublicAccount()?.address ?? null);
            navigate("/home", { replace: true, state: { sortedPrices } });
      };

      return (
            <main onTouchStart={onPullStart} onTouchMove={onPullMove} onTouchEnd={onPullEnd} onTouchCancel={onPullCancel} className="scrollbar-hidden min-h-[100dvh] w-full select-none bg-[#050407] pb-[88px] text-[#f6f2ff]">
                  <header className="sticky top-0 z-20 border-b border-[rgba(230,224,255,0.08)] bg-[rgba(5,4,7,0.82)] backdrop-blur-xl" style={{ paddingTop: "env(safe-area-inset-top)" }}>
                        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-8">
                              <BrandMark />
                              <AccountMenu
                                    address={address}
                                    onCreatePasskey={() => setCreatePasskeyOpen(true)}
                                    onSwitchPasskey={switchPasskey}
                                    onSignOut={() => { signOut(); navigate("/", { replace: true }); }}
                              />
                        </div>
                  </header>

                  <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-5 sm:px-8 sm:pt-8">
                        <div className="flex items-center justify-center gap-2 overflow-hidden font-mono text-[10px] uppercase tracking-[0.16em] text-[#b8a9ff]" style={{ height: pullDistance }} aria-hidden="true">
                              <RefreshCwIcon className="h-4 w-4 shrink-0" style={{ transform: `rotate(${pullDistance * 3}deg)` }} />
                              {pullDistance >= 64 ? "Release to refresh" : "Pull to refresh"}
                        </div>

                        <div className="lg:grid lg:grid-cols-[minmax(0,420px)_1fr] lg:items-start lg:gap-10">
                              <section aria-labelledby="portfolio-title">
                                    <h1 id="portfolio-title" className="sr-only">Portfolio</h1>
                                    <div className="flex items-end justify-between gap-3">
                                          <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#8f879c]">Estimated total · Monad testnet</p>
                                                      <button type="button" onClick={refreshBalances} disabled={!address || balanceLoading} aria-label="Refresh balances" title="Refresh balances" className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[rgba(136,115,255,0.2)] text-[#b8a9ff] outline-none transition-colors hover:border-[#8873ff] hover:bg-[rgba(136,115,255,0.1)] focus-visible:ring-2 focus-visible:ring-[#9b87ff] disabled:opacity-50"><RefreshCwIcon className={`h-3 w-3 ${balanceLoading ? "animate-spin" : ""}`} aria-hidden="true" /></button>
                                                </div>
                                                <p className="mt-1.5 truncate font-display text-[34px] font-semibold tabular-nums leading-10 text-[#fffaff] sm:text-[40px] sm:leading-[48px]">{estimatedTotal ?? "—"}</p>
                                                <p className="mt-1 break-all font-mono text-[11px] text-[#8f879c]">{address ?? "No address available"}</p>
                                                {balanceLoading && <p className="mt-2 font-mono text-[10px] text-[#a59db3]">Fetching balances…</p>}
                                          </div>
                                          <button type="button" disabled={!balances || !address} onClick={() => { setTransferToken("AUSD"); setTransferOpen(true); }} className="group mb-1 flex h-11 shrink-0 items-center gap-2 rounded-full border border-[rgba(230,224,255,0.22)] bg-[rgba(255,255,255,0.04)] pl-4 pr-1.5 font-display text-sm font-semibold text-[#f7f4ff] outline-none disabled:cursor-not-allowed disabled:opacity-40">
                                                Transfer
                                                <span className="grid h-8 w-8 place-items-center rounded-full bg-[#8873ff]" aria-hidden="true">
                                                      <ArrowUpRightIcon className="h-4 w-4 text-[#0a0710]" />
                                                </span>
                                          </button>
                                    </div>

                                    {balanceError && <div role="alert" className="mt-4 flex items-center gap-3 rounded-[18px] border border-[rgba(255,142,166,0.25)] bg-[linear-gradient(110deg,rgba(255,142,166,0.08),rgba(136,115,255,0.06))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border border-[rgba(255,142,166,0.24)] bg-[rgba(255,142,166,0.1)]"><CloudOffIcon className="h-5 w-5 text-[#ff9bb1]" aria-hidden="true" /></span>
                                          <span className="min-w-0 flex-1"><span className="block font-display text-sm font-semibold text-[#f7f4ff]">Balance sync unavailable</span><span className="block font-mono text-[10px] leading-4 text-[#aaa2b5]">Pull down or tap retry.</span></span>
                                          <button type="button" onClick={refreshBalances} disabled={balanceLoading} aria-label="Retry balance refresh" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[rgba(230,224,255,0.18)] text-[#e7e1f3] outline-none transition-colors hover:border-[#8873ff] hover:bg-[rgba(136,115,255,0.1)] focus-visible:ring-2 focus-visible:ring-[#9b87ff] disabled:opacity-50"><RefreshCwIcon className={`h-4 w-4 ${balanceLoading ? "animate-spin" : ""}`} aria-hidden="true" /></button>
                                    </div>}

                                    <div className="mt-6 grid grid-cols-2 gap-2.5 sm:gap-3">
                                          {FEATURED.map((token, index) => (
                                                <InteractiveTokenCard
                                                      key={token.symbol}
                                                      symbol={token.symbol}
                                                      name={token.name}
                                                      color={token.color}
                                                      still={token.still}
                                                      base={token.base}
                                                      emblem={token.emblem}
                                                      balance={balances ? formatBalance(token.symbol === "MON" ? balances.mon : balances.ausd) : "—"}
                                                      usdValue={token.symbol === "AUSD" && ausdCents !== null ? displayUsd(ausdCents) : token.symbol === "MON" && monCents !== null ? displayUsd(monCents) : "USD value unavailable"}
                                                      disabled={!balances || !address}
                                                      index={index}
                                                      onSend={() => { setTransferToken(token.symbol); setTransferOpen(true); }}
                                                />
                                          ))}
                                    </div>
                                    <button type="button" disabled={!address} onClick={() => setFaucetOpen(true)} aria-label="Request AUSD from faucet" className="group relative mt-3 flex h-[72px] w-full items-center overflow-hidden rounded-[18px] pl-[78px] pr-[62px] text-left outline-none transition-transform active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-[#5ec8ff] disabled:cursor-not-allowed disabled:opacity-40">
                                          <img src={faucetGatewayArt} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-fill" />
                                          <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(3,8,18,0.36)_26%,rgba(3,8,18,0.18)_72%,transparent_100%)]" />
                                          <span className="relative z-10 min-w-0"><span className="block truncate font-display text-[13px] font-semibold text-[#e9f8ff]">Get testnet AUSD</span><span className="block truncate font-mono text-[10px] text-[#a8c3d1]">Request from Agora faucet</span></span>
                                    </button>
                              </section>

                              <section aria-labelledby="tokens-title" className="mt-8 lg:mt-0">
                                    <div className="relative mb-2 h-[58px] overflow-hidden rounded-[16px]">
                                          <img src={marketHeaderArt} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-fill" />
                                          <h2 id="tokens-title" className="relative z-10 flex h-full items-center pl-[60px] pr-4 font-display text-base font-semibold text-[#f7f4ff]">All Perpetual Markets</h2>
                                    </div>
                                    <ul className="space-y-1.5">
                                          {sortedPrices.map((token) => {
                                                const symbol = token.symbol.split(/[-/]/)[0].toUpperCase();
                                                const meta = TOKEN_META[symbol] ?? { name: symbol, color: "#a99bff" };
                                                return (
                                                      <li key={token.marketId} className="relative isolate min-h-[76px] overflow-hidden rounded-[18px]">
                                                            <button type="button" onClick={() => navigate("/trade", { state: { marketId: token.marketId } })} className="relative flex min-h-[76px] w-full items-center px-5 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#8873ff]">
                                                            <img src={marketCellArt} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-fill" />
                                                            <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(3,6,14,0.05),rgba(3,6,14,0.15)_65%,rgba(3,6,14,0.32))]" />
                                                            <div className="relative z-10 flex w-full items-center gap-3">
                                                                  <TokenGlyph glyph={symbol[0] ?? "?"} color={meta.color} />
                                                                  <div className="min-w-0 flex-1">
                                                                        <p className="truncate font-display text-[15px] font-semibold text-[#f7f4ff]">{meta.name}</p>
                                                                        <p className="font-mono text-[10px] text-[#8f879c]">{token.symbol}</p>
                                                                  </div>
                                                                  <p className="font-mono text-[13px] font-medium tabular-nums text-[#e7e1f3]">{token.price.startsWith("$") ? token.price : `$${token.price}`}</p>
                                                            </div>
                                                            </button>
                                                      </li>
                                                );
                                          })}
                                          {sortedPrices.length === 0 && (
                                                <li className="relative flex min-h-[76px] items-center justify-center overflow-hidden rounded-[18px] px-4 py-6 text-center font-mono text-xs text-[#a9a2bb]">
                                                      <img src={marketCellArt} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-fill" />
                                                      <span className="relative z-10">
                                                      {status.state === "error" ? "Market prices are unavailable." : "Loading market prices…"}
                                                      </span>
                                                </li>
                                          )}
                                    </ul>
                              </section>
                        </div>
                  </div>
                  <PasskeySheet
                        open={createPasskeyOpen}
                        onClose={() => setCreatePasskeyOpen(false)}
                        sortedPrices={sortedPrices}
                        onCreated={(createdAddress) => {
                              setAddress(createdAddress);
                              setCreatePasskeyOpen(false);
                        }}
                  />
                  {address && balances && <TransferSheet open={transferOpen} token={transferToken} address={address} balances={balances} onClose={() => setTransferOpen(false)} onConfirmed={refreshBalances} />}
                  {address && <FaucetSheet open={faucetOpen} address={address} onClose={() => setFaucetOpen(false)} onConfirmed={refreshBalances} />}
                  <AppTabs active="home" />
            </main>
      );
}
