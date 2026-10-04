import { notify } from "../notifications/store";
import { useEffect, useRef, useState } from "react";
import { getEvmAddress } from "@category-labs/mera";
import { CheckIcon, CopyIcon, FingerprintIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { Sheet, TokenGlyph, VerificationProgress } from "./TransferPrimitives";
import { buildFaucetRequest } from "../transactions/wallet";
import type { Review } from "../transactions/types";
import { chooseSpecificFromExisting } from "../utils/getCredentials";
import { loadPublicAccount } from "../utils/storageSaveAndLoad";
import { createSigningSession } from "../utils/signingSession";
import { signTransactionDigest } from "../transactions/signDigest";
import { broadcastTransaction } from "../transactions/broadcastTransaction";
import { errorText } from "../utils/errorText";

type Step = "preparing" | "review" | "sending" | "success" | "submitted" | "error";
type Props = { open: boolean; address: string; onClose: () => void; onConfirmed: () => void };
const shorten = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;

export function FaucetSheet({ open, address, onClose, onConfirmed }: Props) {
  const [step, setStep] = useState<Step>("preparing");
  const [review, setReview] = useState<Review | null>(null);
  const [hash, setHash] = useState("");
  const [error, setError] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const prepareId = useRef(0);

  useEffect(() => {
    if (!open) return;
    const requestId = ++prepareId.current;
    setStep("preparing"); setReview(null); setHash(""); setError(""); setCopyState("idle");
    buildFaucetRequest(address).then((next) => {
      if (prepareId.current === requestId) { setReview(next); setStep("review"); }
    }).catch((cause: unknown) => {
      if (prepareId.current === requestId) { setError(errorText(cause)); setStep("error"); }
    });
    return () => { prepareId.current++; };
  }, [open, address]);

  const prepareAgain = async () => {
    const requestId = ++prepareId.current;
    setStep("preparing"); setReview(null); setError(""); setHash(""); setCopyState("idle");
    try {
      const next = await buildFaucetRequest(address);
      if (prepareId.current === requestId) { setReview(next); setStep("review"); }
    } catch (cause) {
      if (prepareId.current === requestId) { setError(errorText(cause)); setStep("error"); }
    }
  };

  const request = async () => {
    if (step !== "review" || !review) return;
    setStep("sending"); setError("");
    let session: Awaited<ReturnType<typeof createSigningSession>> | undefined;
    try {
      const publicAccount = loadPublicAccount();
      if (!publicAccount || publicAccount.address.toLowerCase() !== address.toLowerCase()) throw new Error("Sign in to this wallet again before requesting AUSD.");
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
    try { await navigator.clipboard.writeText(hash); setCopyState("copied"); notify({ title: "Transaction hash copied", message: "Ready to paste from your clipboard." }); }
    catch { setCopyState("error"); notify({ kind: "error", title: "Could not copy", message: "Try copying the transaction hash again." }); }
  };
  const close = () => { if (step !== "preparing" && step !== "sending") { prepareId.current++; onClose(); } };
  const eyebrow = ({ preparing: "AUSD · Checking faucet", review: "AUSD · Review request", sending: "AUSD · Signing", success: "AUSD · Received", submitted: "AUSD · Submitted", error: "AUSD · Faucet unavailable" } as const)[step];
  const hashButton = hash && <button type="button" onClick={() => { void copyHash(); }} aria-label={copyState === "copied" ? "Transaction hash copied" : "Copy transaction hash"} className="mt-5 flex w-full items-center justify-between rounded-[14px] border border-[rgba(230,224,255,0.12)] bg-[rgba(255,255,255,0.025)] px-3.5 py-3 font-mono text-[11px]"><span>{shorten(hash)}</span><span className={`flex items-center gap-1.5 ${copyState === "copied" ? "text-[#71f7b5]" : copyState === "error" ? "text-[#ff8ea6]" : "text-[#a59db3]"}`}>{copyState === "copied" ? <CheckIcon className="h-3.5 w-3.5" /> : copyState === "error" ? <XIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}{copyState === "copied" ? "Copied" : copyState === "error" ? "Try again" : "Copy"}</span></button>;

  return <Sheet open={open} onClose={close} eyebrow={eyebrow} tone={step === "error" ? "error" : step === "success" ? "success" : "default"} labelledBy="faucet-title" viewKey={step}>
    {step === "preparing" && <VerificationProgress titleId="faucet-title" title="Checking the AUSD faucet" description="Reading the current faucet amount and estimating the Monad network fee." steps={["Checking faucet", "Checking wallet", "Estimating fee"]} />}

    {step === "review" && review && <div>
      <h2 id="faucet-title" className="font-display text-2xl font-semibold text-[#f7f4ff]">Request testnet AUSD</h2>
      <div className="mt-5 flex flex-col items-center rounded-[20px] border border-[rgba(94,200,255,0.24)] bg-[rgba(94,200,255,0.05)] px-4 py-5">
        <TokenGlyph glyph="A" color="#5ec8ff" large />
        <p className="mt-2 font-display text-[32px] font-semibold tabular-nums text-[#fffaff]">{review.amount} <span className="text-lg text-[#a59db3]">AUSD</span></p>
        <p className="mt-1 font-mono text-[10px] text-[#a59db3]">To {shorten(address)}</p>
      </div>
      <dl className="mt-3 space-y-2 rounded-[14px] border border-dashed border-[rgba(230,224,255,0.12)] px-3.5 py-3 font-mono text-[11px]">
        <div className="flex justify-between gap-3"><dt className="text-[#8f879c]">Network</dt><dd>Monad testnet</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-[#8f879c]">Maximum network fee</dt><dd>{review.maxNetworkFee} MON</dd></div>
      </dl>
      <p className="mt-3 text-xs leading-5 text-[#a59db3]">The faucet is shared across users and allows one request every 60 seconds. Another request may use the slot before yours confirms.</p>
      <button type="button" onClick={() => { void request(); }} className="mt-5 flex h-14 w-full items-center justify-center gap-2.5 rounded-[18px] bg-[#5ec8ff] font-display text-[15px] font-semibold text-[#071016]"><FingerprintIcon className="h-[18px] w-[18px]" />Confirm with passkey</button>
    </div>}

    {step === "sending" && <VerificationProgress titleId="faucet-title" title="Requesting AUSD" description="Verify with your passkey and wait for Monad confirmation." steps={["Verifying passkey", "Signing request", "Confirming on Monad"]} />}

    {(step === "success" || step === "submitted") && <div className="flex flex-col items-center text-center" role="status">
      <span className="mt-3 grid h-20 w-20 place-items-center rounded-[24px] bg-[rgba(113,247,181,0.14)]"><CheckIcon className="h-9 w-9 text-[#71f7b5]" /></span>
      <h2 id="faucet-title" className="mt-4 font-display text-2xl font-semibold">{step === "success" ? "AUSD received" : "Request submitted"}</h2>
      <p className="mt-2 text-sm leading-6 text-[#b8b0c8]">{step === "success" ? `${review?.amount ?? "Testnet"} AUSD was sent to your wallet.` : "The network received your request. Confirmation is still pending; check its transaction hash before trying again."}</p>
      {hashButton}
      <button type="button" onClick={onClose} className="mt-5 h-14 w-full rounded-[18px] bg-[#f7f4ff] font-display text-[15px] font-semibold text-[#0a0710]">Done</button>
    </div>}

    {step === "error" && <div role="alert" className="flex flex-col items-center text-center">
      <span className="mt-3 grid h-20 w-20 place-items-center rounded-[24px] bg-[rgba(255,142,166,0.1)]"><XIcon className="h-8 w-8 text-[#ff8ea6]" /></span>
      <h2 id="faucet-title" className="mt-4 font-display text-2xl font-semibold">{hash && !error.includes("failed on Monad") ? "Request status unknown" : "Faucet request unavailable"}</h2>
      <p className="mt-3 break-words text-sm leading-6 text-[#ff8ea6]">{error}</p>
      {hashButton}
      {hash && !error.includes("failed on Monad") && <p className="mt-2 text-xs text-[#cfc7dc]">Check this transaction hash on Monad before requesting again.</p>}
      {!hash && <button type="button" onClick={() => { void prepareAgain(); }} className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-[18px] bg-[#f7f4ff] font-display text-sm font-semibold text-[#0a0710]"><RefreshCwIcon className="h-4 w-4" />Try again</button>}
      {hash && <button type="button" onClick={onClose} className="mt-6 h-14 w-full rounded-[18px] bg-[#f7f4ff] font-display text-sm font-semibold text-[#0a0710]">Done</button>}
    </div>}
  </Sheet>;
}
