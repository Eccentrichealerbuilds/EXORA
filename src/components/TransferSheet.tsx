import { notify } from "../notifications/store";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDownIcon, ArrowRightIcon, CheckIcon, ChevronLeftIcon, CopyIcon, FingerprintIcon, XIcon } from "lucide-react";
import { getEvmAddress } from "@category-labs/mera";
import { AccountAvatar, Sheet, TokenGlyph, VerificationProgress } from "./TransferPrimitives";
import { buildTransaction, type Asset, type WalletBalances } from "../transactions/wallet";
import type { Review } from "../transactions/types";
import { chooseSpecificFromExisting } from "../utils/getCredentials";
import { loadPublicAccount } from "../utils/storageSaveAndLoad";
import { createSigningSession } from "../utils/signingSession";
import { signTransactionDigest } from "../transactions/signDigest";
import { broadcastTransaction } from "../transactions/broadcastTransaction";
import { formatBalance } from "../utils/formatBalance";
import { errorText } from "../utils/errorText";

type Step = "compose" | "building" | "review" | "sending" | "success" | "submitted" | "error";
type Props = { open: boolean; token: Asset; address: string; balances: WalletBalances; onClose: () => void; onConfirmed: () => void };
const TOKENS = { AUSD: { glyph: "A", color: "#5ec8ff", decimals: 6 }, MON: { glyph: "M", color: "#8873ff", decimals: 18 } } as const;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const shorten = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
function units(value: string, decimals: number): bigint | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) return null;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}
function fromUnits(value: bigint, decimals: number) {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function TransferSheet({ open, token, address, balances, onClose, onConfirmed }: Props) {
  const [step, setStep] = useState<Step>("compose");
  const [symbol, setSymbol] = useState<Asset>(token);
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [hash, setHash] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [error, setError] = useState("");
  const meta = TOKENS[symbol];
  const available = symbol === "MON" ? balances.mon : balances.ausd;
  const amountUnits = units(amount, meta.decimals);
  const availableUnits = units(available, meta.decimals);
  const amountValid = amountUnits !== null && availableUnits !== null && amountUnits > 0n && amountUnits <= availableUnits;
  const recipientValid = ADDRESS.test(recipient.trim()) && recipient.trim().toLowerCase() !== address.toLowerCase() && !/^0x0{40}$/i.test(recipient.trim());
  const canReview = amountValid && recipientValid;
  const canClose = step !== "sending" && step !== "building";

  useEffect(() => {
    if (!open) return;
    setStep("compose"); setSymbol(token); setAmount(""); setRecipient(""); setReview(null); setHash(""); setError("");
  }, [open, token, address]);

  useEffect(() => { setCopyState("idle"); }, [hash, open]);

  const close = () => { if (canClose) onClose(); };
  const chooseFraction = (label: string) => {
    if (availableUnits === null) return;
    const value = label === "Max"
      ? symbol === "MON" ? availableUnits > 10n ** 16n ? availableUnits - 10n ** 16n : 0n : availableUnits
      : availableUnits * BigInt(label === "25%" ? 25 : 50) / 100n;
    setAmount(fromUnits(value, meta.decimals));
  };
  const prepare = async () => {
    if (!canReview || step !== "compose") return;
    setError(""); setStep("building");
    try {
      const next = await buildTransaction(address, recipient.trim(), amount, symbol);
      setReview(next); setStep("review");
    } catch (cause) {
      setError(errorText(cause)); setStep("compose");
    }
  };
  const send = async () => {
    if (!review || step !== "review") return;
    setStep("sending"); setError("");
    let session: Awaited<ReturnType<typeof createSigningSession>> | undefined;
    try {
      const publicAccount = loadPublicAccount();
      if (!publicAccount || publicAccount.address.toLowerCase() !== address.toLowerCase()) throw new Error("Sign in to this wallet again before sending.");
      const privateKey = await chooseSpecificFromExisting(publicAccount);
      session = await createSigningSession(privateKey);
      if (getEvmAddress(session.publicKey).toLowerCase() !== address.toLowerCase()) throw new Error("The selected passkey belongs to another wallet.");
      const signedHash = await signTransactionDigest(review.id, session, review.digest);
      setHash(String(signedHash));
      const confirmedHash = await broadcastTransaction(review.id);
      setHash(confirmedHash);
      setStep("success");
      onConfirmed();
    } catch (cause) {
      const message = errorText(cause);
      const submittedHash = message.match(/Transaction (0x[0-9a-fA-F]{64}) was submitted/);
      if (submittedHash) {
        setHash(submittedHash[1]); setStep("submitted");
      } else {
        setError(message); setStep("error");
      }
    } finally {
      session?.end();
    }
  };
  const copyHash = async () => {
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(hash);
      setCopyState("copied"); notify({ title: "Transaction hash copied", message: "Ready to paste from your clipboard." });
    } catch {
      setCopyState("error"); notify({ kind: "error", title: "Could not copy", message: "Try copying the transaction hash again." });
    }
  };
  const eyebrow = ({ compose: "Transfer · Details", building: "Transfer · Preparing", review: "Transfer · Review", sending: "Transfer · Signing", success: "Transfer · Complete", submitted: "Transfer · Submitted", error: "Transfer failed" } as const)[step];

  return <Sheet open={open} onClose={close} eyebrow={eyebrow} tone={step === "error" ? "error" : step === "success" ? "success" : "default"} labelledBy="transfer-title" viewKey={step}>
    {step === "compose" && <form onSubmit={(event) => { event.preventDefault(); void prepare(); }}>
      <h2 id="transfer-title" className="font-display text-2xl font-semibold text-[#f7f4ff]">Send</h2>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {(["AUSD", "MON"] as const).map((item) => <button key={item} type="button" aria-pressed={item === symbol} onClick={() => { setSymbol(item); setAmount(""); }} className={`flex min-w-0 items-center gap-2 rounded-[16px] border px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#9b87ff] ${item === symbol ? "border-[rgba(136,115,255,0.7)] bg-[rgba(136,115,255,0.12)]" : "border-[rgba(230,224,255,0.12)] bg-[rgba(255,255,255,0.02)]"}`}>
          <TokenGlyph glyph={TOKENS[item].glyph} color={TOKENS[item].color} /><span className="min-w-0 flex-1"><span className="block font-display text-sm font-semibold">{item}</span><span className="block truncate font-mono text-[10px] text-[#a59db3]">{formatBalance(item === "MON" ? balances.mon : balances.ausd)}</span></span>
        </button>)}
      </div>
      <div className="mt-3 rounded-[20px] border border-[rgba(230,224,255,0.14)] bg-[rgba(255,255,255,0.025)] px-4 pb-3 pt-3.5 focus-within:border-[#8873ff]">
        <label htmlFor="transfer-amount" className="block text-center font-mono text-[9px] uppercase tracking-[0.18em] text-[#a59db3]">Amount</label>
        <div className="mt-1 flex items-baseline justify-center gap-2"><input id="transfer-amount" inputMode="decimal" autoFocus placeholder="0" value={amount} onChange={(event) => setAmount(event.target.value)} className="w-full min-w-0 select-text bg-transparent text-right font-display text-[40px] font-semibold tabular-nums leading-[48px] text-[#fffaff] outline-none placeholder:text-[#3d3747]" style={{ maxWidth: `${Math.max(amount.length, 1) + 1}ch` }} /><span className="font-display text-lg font-semibold text-[#8f879c]">{symbol}</span></div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-[rgba(230,224,255,0.08)] pt-3"><span className="min-w-0 truncate font-mono text-[10px] text-[#8f879c]">Available {formatBalance(available)} {symbol}</span><div className="flex shrink-0 gap-1">{["25%", "50%", "Max"].map((label) => <button key={label} type="button" onClick={() => chooseFraction(label)} className="rounded-full border border-[rgba(230,224,255,0.14)] px-2.5 py-1 font-mono text-[9px] uppercase text-[#cfc7dc] hover:border-[#8873ff]">{label}</button>)}</div></div>
        {symbol === "MON" && <p className="mt-2 font-mono text-[10px] text-[#8f879c]">Max reserves 0.01 MON for the network fee.</p>}
      </div>
      <label htmlFor="transfer-recipient" className="mt-4 block rounded-[16px] border border-[rgba(230,224,255,0.14)] bg-[rgba(255,255,255,0.03)] px-4 py-2.5 focus-within:border-[#8873ff]"><span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-[#a59db3]">Recipient</span><input id="transfer-recipient" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="0x Monad address" autoComplete="off" spellCheck={false} className="mt-1 w-full select-text bg-transparent font-display text-base text-[#f7f4ff] outline-none placeholder:text-[#5d5669]" /></label>
      <p className="mt-1.5 px-1 font-mono text-[10px] text-[#7d7589]">Send to any Monad testnet address.</p>
      <dl className="mt-4 rounded-[14px] border border-dashed border-[rgba(230,224,255,0.12)] px-3.5 py-3 font-mono text-[11px]"><div className="flex justify-between"><dt className="text-[#8f879c]">Network fee</dt><dd className="text-[#e7e1f3]">Calculated for review</dd></div></dl>
      {error && <p role="alert" className="mt-3 text-sm text-[#ff8ea6]">{error}</p>}
      <button type="submit" disabled={!canReview} className="group mt-5 flex h-14 w-full items-center justify-center gap-2.5 rounded-[18px] bg-[#8873ff] font-display text-[15px] font-semibold text-[#0a0710] disabled:cursor-not-allowed disabled:opacity-40">Review transfer <ArrowRightIcon className="h-4 w-4" /></button>
    </form>}
    {step === "building" && <VerificationProgress titleId="transfer-title" title="Preparing transfer" description="Checking your balance and estimating the network fee." steps={["Checking balance", "Estimating fee", "Preparing review"]} />}
    {step === "review" && review && <div>
      <h2 id="transfer-title" className="font-display text-2xl font-semibold">Review transfer</h2>
      <div className="mt-5 flex flex-col items-center rounded-[20px] border border-[rgba(230,224,255,0.14)] bg-[rgba(255,255,255,0.025)] px-4 py-5"><TokenGlyph glyph={meta.glyph} color={meta.color} large /><p className="mt-2 font-display text-[34px] font-semibold tabular-nums">{review.amount} <span className="text-lg text-[#8f879c]">{review.asset}</span></p></div>
      <div className="mt-3 rounded-[20px] border border-[rgba(230,224,255,0.12)]"><div className="flex items-center gap-3 px-4 py-3"><AccountAvatar initial={address[2]} large /><div className="min-w-0"><p className="font-mono text-[9px] uppercase text-[#8f879c]">From</p><p className="truncate font-mono text-sm">{review.from}</p></div></div><div className="relative h-px bg-[rgba(230,224,255,0.1)]"><span className="absolute left-1/2 top-1/2 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[rgba(136,115,255,0.5)] bg-[#0b0912]"><ArrowDownIcon className="h-3.5 w-3.5 text-[#b8a9ff]" /></span></div><div className="flex items-center gap-3 px-4 py-3"><AccountAvatar initial={recipient[2]} large muted /><div className="min-w-0"><p className="font-mono text-[9px] uppercase text-[#8f879c]">To</p><p className="truncate font-mono text-sm">{review.to}</p></div></div></div>
      <dl className="mt-3 space-y-2 rounded-[14px] border border-dashed border-[rgba(230,224,255,0.12)] px-3.5 py-3 font-mono text-[11px]"><div className="flex justify-between"><dt className="text-[#8f879c]">Network</dt><dd>Monad testnet</dd></div><div className="flex justify-between"><dt className="text-[#8f879c]">Maximum network fee</dt><dd>{review.maxNetworkFee} MON</dd></div></dl>
      <div className="mt-5 grid grid-cols-[auto_1fr] gap-2.5"><button type="button" onClick={() => { setReview(null); setStep("compose"); }} aria-label="Back" className="grid h-14 w-14 place-items-center rounded-[18px] border border-[rgba(230,224,255,0.18)]"><ChevronLeftIcon className="h-5 w-5" /></button><button type="button" onClick={() => { void send(); }} className="flex h-14 items-center justify-center gap-2.5 rounded-[18px] bg-[#8873ff] font-display text-[15px] font-semibold text-[#0a0710]"><FingerprintIcon className="h-[18px] w-[18px]" />Confirm with passkey</button></div>
    </div>}
    {step === "sending" && <VerificationProgress titleId="transfer-title" title="Authorize with passkey" description={`Sign and send ${amount} ${symbol}. Waiting for Monad confirmation.`} steps={["Verifying passkey", "Signing transaction", "Confirming on Monad"]} />}
    {(step === "success" || step === "submitted") && <div className="flex flex-col items-center text-center" role="status"><div className="relative mt-2 grid h-24 w-24 place-items-center"><motion.span className="absolute h-14 w-14 rounded-[16px] bg-[#71f7b5]" initial={{ rotate: -45, scale: 0.4 }} animate={{ rotate: 45, scale: 1 }} /><CheckIcon className="relative h-6 w-6 text-[#05140d]" strokeWidth={3} /></div><h2 id="transfer-title" className="mt-4 font-display text-2xl font-semibold">{step === "success" ? "Transfer confirmed" : "Transfer submitted"}</h2><p className="mt-2 text-sm leading-6 text-[#b8b0c8]">{step === "success" ? `${amount} ${symbol} reached ${shorten(recipient)}.` : "The network received your transfer. Confirmation is still pending; check its transaction hash before sending again."}</p><button type="button" onClick={() => { void copyHash(); }} aria-label={copyState === "copied" ? "Transaction hash copied" : "Copy transaction hash"} className={`mt-5 flex w-full items-center justify-between rounded-[14px] border px-3.5 py-3 font-mono text-[11px] transition-colors ${copyState === "copied" ? "border-[rgba(113,247,181,0.42)] bg-[rgba(113,247,181,0.07)]" : "border-[rgba(230,224,255,0.12)] bg-[rgba(255,255,255,0.025)]"}`}><span className="text-[#e7e1f3]">{shorten(hash)}</span><span className={`flex items-center gap-1.5 ${copyState === "copied" ? "text-[#71f7b5]" : copyState === "error" ? "text-[#ff8ea6]" : "text-[#a59db3]"}`}>{copyState === "copied" ? <CheckIcon className="h-3.5 w-3.5" /> : copyState === "error" ? <XIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}{copyState === "copied" ? "Copied" : copyState === "error" ? "Try again" : "Copy"}</span></button><span className="sr-only" role="status" aria-live="polite">{copyState === "copied" ? "Transaction hash copied" : copyState === "error" ? "Could not copy transaction hash" : ""}</span><button type="button" onClick={onClose} className="mt-5 h-14 w-full rounded-[18px] bg-[#f7f4ff] font-display text-[15px] font-semibold text-[#0a0710]">Done</button></div>}
    {step === "error" && <div role="alert" className="flex flex-col items-center text-center"><h2 id="transfer-title" className="mt-8 font-display text-2xl font-semibold">{hash && !error.includes("failed on Monad") ? "Transfer status unknown" : "Transfer didn't go through"}</h2><p className="mt-3 break-words text-sm leading-6 text-[#ff8ea6]">{error}</p>{hash && <p className="mt-2 break-all font-mono text-[10px] text-[#a59db3]">Transaction: {hash}</p>}{hash && !error.includes("failed on Monad") && <p className="mt-3 text-xs text-[#cfc7dc]">Check this transaction hash on Monad before sending again.</p>}<button type="button" onClick={() => { setReview(null); setStep("compose"); }} className="mt-6 h-14 w-full rounded-[18px] border border-[rgba(230,224,255,0.18)] font-display text-sm font-semibold">Edit transfer</button></div>}
  </Sheet>;
}
