import { withDeadline } from "../utils/withDeadline";
import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getEvmAddress } from "@category-labs/mera";
import { chooseSpecificFromExisting } from "../utils/getCredentials";
import { loadPublicAccount } from "../utils/storageSaveAndLoad";
import { createSigningSession } from "../utils/signingSession";
import { signTransactionDigest } from "../transactions/signDigest";
import { broadcastTransaction } from "../transactions/broadcastTransaction";

export type Position = {
  marketId: number; symbol: string; side: "long" | "short"; size: string;
  entryPrice: string; markPrice: string; deposit: string; pnl: string; premiumPnl: string;
};
export type Account = {
  address: string; exists: boolean; accountId: number | null; frozen: boolean;
  balance: string; lockedBalance: string; committedMargin: string; availableBalance: string;
  walletAusd: string; allowance: string; minimumOpen: string; positions: Position[];
};
export type Activity = {
  id: string; kind: string; marketId: number | null; symbol: string | null;
  side: string | null; amount: string | null; price: string | null;
  transactionHash: string; blockNumber: number; timestampMs: number;
};
export type ActivityPage = { items: Activity[]; nextCursor: string | null };
export type OpenOrder = {
  marketId: number; orderId: number; contractOrderId: number | null; orderType: number; status: number;
  priceRaw: string | null; sizeRaw: string | null; triggerPriceRaw: string | null;
  triggerCondition: number | null; positionId: number | null; requestId: number | null;
};
export type PrivateEvent =
  | { type: "status"; state: string; message?: string | null }
  | { type: "orders"; orders: OpenOrder[] }
  | { type: "accountChanged" }
  | { type: "forwarding"; allowed: boolean };
export type OrderInput = {
  address: string; marketId: number; side: "long" | "short";
  orderType: "market" | "limit"; sizeUsd: string; leverageHundredths: number;
  limitPrice: string | null; slippageBps: number | null;
  timeInForce: "gtc" | "ioc" | "fok" | "postOnly" | null;
};
export type OrderQuote = {
  marketId: number; symbol: string; side: "long" | "short"; orderType: "market" | "limit";
  sizeUsd: string; quantity: string; referencePrice: string; worstPrice: string;
  estimatedMargin: string; estimatedFee: string; availableBalance: string;
  leverageHundredths: number; maxLeverageHundredths: number;
  slippageBps: number; headBlock: number;
  timeInForce: "gtc" | "ioc" | "fok" | "postOnly";
  indicativeFillQuantity: string | null; indicativeAveragePrice: string | null; bookTimestampMs: number | null;
};
export type TxReview = {
  id: string; digest: string; from: string; to: string; action: string;
  amount: string | null; quote: OrderQuote | null; chainId: number;
  nonce: number; gasLimit: number; maxNetworkFee: string;
};
export type FundingAction = "approve" | "createAccount" | "deposit" | "withdraw";
export type CloseInput = { address: string; marketId: number; slippageBps: number;
  quantity: string | null; limitPrice: string | null };
export type OrderOutcome = {
  status: "filled" | "partiallyFilled" | "unfilled" | "resting" | "unknown";
  marketId: number | null; requested: string | null; filled: string | null;
  remaining: string | null; averagePrice: string | null; fee: string | null;
  restingOrderId: number | null;
};
export type ConfirmedTx = { hash: string; outcome: OrderOutcome | null };
export type PendingTxStatus = { action: string; state: "pending" | "confirmed" | "failed"; hash: string | null };
export type TriggerInput = { address: string; marketId: number; kind: "stopLoss" | "takeProfit";
  triggerPrice: string; quantity: string; limitPrice: string | null; slippageBps: number };
export type TriggerPreview = { symbol: string; side: "long" | "short";
  kind: "stopLoss" | "takeProfit"; quantity: string; triggerPrice: string;
  limitPrice: string | null; markPrice: string; slippageBps: number };
export type TriggerResult = { requestId: number; orderId: number | null; state: "armed" | "triggered" | "pending" | "canceled" };
export type PendingTrigger = { marketId: number; requestId: number };
export const pendingTriggers = (address: string) => invoke<PendingTrigger[]>("pending_perpl_triggers", { address });
export const reconcileTrigger = (address: string, marketId: number) => verifiedPasskey(address,
  (_session, wrappingKeyHex) => invoke<TriggerResult>("reconcile_perpl_trigger", { address, marketId, wrappingKeyHex }));
export const hasProtectedOrderAccess = (address: string) => invoke<boolean>("has_perpl_trade_key", { address });
export const previewTrigger = (input: TriggerInput) => prepareRequest<TriggerPreview>("preview_perpl_trigger", { input });
export const buildForwarding = (address: string) => prepareRequest<TxReview>("build_perpl_forwarding", { address });

const verifiedPasskey = async <T>(address: string,
  run: (session: Awaited<ReturnType<typeof createSigningSession>>, wrappingKeyHex: string) => Promise<T>): Promise<T> => {
  const publicAccount = loadPublicAccount();
  if (!publicAccount || publicAccount.address.toLowerCase() !== address.toLowerCase())
    throw new Error("Sign in to this wallet before using protected orders.");
  const privateKey = await withDeadline(chooseSpecificFromExisting(publicAccount), 30_000, "Passkey confirmation expired. Please try again.", key => key.fill(0));
  const domain = new TextEncoder().encode(`EXORA_PERPL_TRADE_KEY_V1:${address.toLowerCase()}:`);
  const material = new Uint8Array(domain.length + privateKey.length);
  material.set(domain); material.set(privateKey, domain.length);
  const wrappingKey = new Uint8Array(await crypto.subtle.digest("SHA-256", material));
  material.fill(0);
  const wrappingKeyHex = Array.from(wrappingKey, byte => byte.toString(16).padStart(2, "0")).join("");
  wrappingKey.fill(0);
  const session = await createSigningSession(privateKey);
  try {
    if (getEvmAddress(session.publicKey).toLowerCase() !== address.toLowerCase())
      throw new Error("The selected passkey belongs to another wallet.");
    return await run(session, wrappingKeyHex);
  } finally { session.end(); }
};

async function enrollProtection(address: string,
  session: Awaited<ReturnType<typeof createSigningSession>>, wrappingKeyHex: string) {
  if (await hasProtectedOrderAccess(address)) return;
  const challenge = await invoke<{ digest: string; address: string }>("begin_perpl_trade_key", { address });
  if (!/^0x[0-9a-fA-F]{64}$/.test(challenge.digest) || challenge.address.toLowerCase() !== address.toLowerCase())
    throw new Error("Perpl returned an invalid protected-order signing request.");
  const digest = Uint8Array.from(challenge.digest.slice(2).match(/../g)!, byte => parseInt(byte, 16));
  const signed = await withDeadline(session.signDigest(digest), 15_000, "Signing did not finish. Please try again.");
  const signature = `0x${Array.from(signed.compact, byte => byte.toString(16).padStart(2, "0")).join("")}${(signed.recovery + 27).toString(16).padStart(2, "0")}`;
  await invoke("complete_perpl_trade_key", { address, signature, wrappingKeyHex });
}

export const placeTrigger = (input: TriggerInput, reviewedPreview: TriggerPreview, setup: TxReview | null,
  onProgress: (stage: string) => void, onSetupConfirmed: () => void) => verifiedPasskey(input.address, async (session, wrappingKeyHex) => {
    onProgress("Preparing stop loss / take profit…");
    await enrollProtection(input.address, session, wrappingKeyHex);
    if (setup) {
      const current = await buildForwarding(input.address);
      if (current.from.toLowerCase() !== input.address.toLowerCase() || current.action !== "forwarding"
        || current.to !== setup.to || current.chainId !== setup.chainId
        || Number(current.maxNetworkFee) > Number(setup.maxNetworkFee))
        throw new Error("Setup fee changed. Review your stop loss / take profit again.");
      onProgress("Confirming first-use permission…");
      await withDeadline(signTransactionDigest(current.id, session, current.digest), 15_000, "Signing did not finish. Please try again.");
      const hash = await broadcastTransaction(current.id, current.action);
      void acknowledgeTransaction(input.address, hash).catch(() => {});
      onSetupConfirmed();
    }
    onProgress("Placing stop loss / take profit…");
    return invoke<TriggerResult>("place_perpl_trigger", { input, reviewedPreview, wrappingKeyHex });
  });
export const cancelTrigger = (address: string, marketId: number, orderId: number) => verifiedPasskey(address,
  async (session, wrappingKeyHex) => {
    await enrollProtection(address, session, wrappingKeyHex);
    return invoke<TriggerResult>("cancel_perpl_trigger", { address, marketId, orderId, wrappingKeyHex });
  });
export const recoverPendingTransactions = (address: string) =>
  invoke<PendingTxStatus[]>("recover_pending_perpl_transactions", { address });
export const acknowledgeTransaction = (address: string, hash: string) =>
  invoke<void>("acknowledge_perpl_transaction", { address, hash });
export const inspectOrderResult = (hash: string) =>
  invoke<OrderOutcome | null>("inspect_perpl_order_result", { hash });

const prepareRequest = <T>(command: string, args: Record<string, unknown>) =>
  withDeadline(invoke<T>(command, args), 30_000, "Preparation took too long. Check your connection and try again.");

export const getAccount = (address: string) => invoke<Account>("get_perpl_account", { address });
export const getActivity = (address: string, cursor: string | null = null) =>
  invoke<ActivityPage>("get_perpl_activity", { address, cursor });
export const hasWalletDataAccess = (address: string) => invoke<boolean>("has_perpl_read_key", { address });
export const forgetWalletDataAccess = (address: string) => invoke<void>("forget_perpl_read_key", { address });
export const buildCancel = (address: string, marketId: number, orderId: number) =>
  prepareRequest<TxReview>("build_perpl_cancel", { address, marketId, orderId });
export const buildChange = (address: string, marketId: number, orderId: number, price: string, size: string) =>
  prepareRequest<TxReview>("build_perpl_change", { address, marketId, orderId, price, size });
export const previewOrder = (input: OrderInput) => prepareRequest<OrderQuote>("preview_perpl_order", { input });
export const buildOrder = (input: OrderInput, reviewedQuote: OrderQuote) =>
  prepareRequest<TxReview>("build_perpl_order", { input, reviewedQuote });
export const previewClose = (input: CloseInput) => prepareRequest<OrderQuote>("preview_perpl_close", { input });
export const buildClose = (input: CloseInput, reviewedQuote: OrderQuote) =>
  prepareRequest<TxReview>("build_perpl_close", { input, reviewedQuote });
export const buildFunding = (address: string, action: FundingAction, amount: string) =>
  prepareRequest<TxReview>("build_perpl_funding", { address, action, amount });

export async function connectWalletData(address: string): Promise<void> {
  const publicAccount = loadPublicAccount();
  if (!publicAccount || publicAccount.address.toLowerCase() !== address.toLowerCase())
    throw new Error("Sign in to this wallet again before connecting Perpl data.");
  const challenge = await invoke<{ digest: string; address: string }>("begin_perpl_read_key", { address });
  if (!/^0x[0-9a-fA-F]{64}$/.test(challenge.digest) || challenge.address.toLowerCase() !== address.toLowerCase())
    throw new Error("Perpl returned an invalid signing request.");
  const privateKey = await withDeadline(chooseSpecificFromExisting(publicAccount), 30_000, "Passkey confirmation expired. Please try again.", key => key.fill(0));
  const session = await createSigningSession(privateKey);
  try {
    if (getEvmAddress(session.publicKey).toLowerCase() !== address.toLowerCase())
      throw new Error("The selected passkey belongs to another wallet.");
    const digest = Uint8Array.from(challenge.digest.slice(2).match(/../g)!, byte => parseInt(byte, 16));
    const signed = await withDeadline(session.signDigest(digest), 15_000, "Signing did not finish. Please try again.");
    const signature = `0x${Array.from(signed.compact, byte => byte.toString(16).padStart(2, "0")).join("")}${(signed.recovery + 27).toString(16).padStart(2, "0")}`;
    await invoke("complete_perpl_read_key", { address, signature });
  } finally { session.end(); }
}

export async function watchPrivateFeed(address: string, onEvent: (event: PrivateEvent) => void): Promise<() => void> {
  const channel = new Channel<PrivateEvent>();
  channel.onmessage = onEvent;
  const id = await invoke<number>("start_private_feed", { address, onPrivate: channel });
  return () => { void invoke("stop_private_feed", { id }); };
}

export async function watchAccount(address: string, onAccount: (account: Account) => void,
  onStatus: (status: { state: string; message?: string }) => void): Promise<() => void> {
  const unlisten = await listen<{ state: string; message?: string }>("perpl-account-status", event => onStatus(event.payload));
  const channel = new Channel<Account>();
  channel.onmessage = onAccount;
  let id: number;
  try { id = await invoke<number>("start_account_feed", { address, onAccount: channel }); }
  catch (error) { unlisten(); throw error; }
  return () => { unlisten(); void invoke("stop_account_feed", { id }); };
}

export async function authorizeAndSend(review: TxReview, address: string,
  refreshReview?: () => Promise<TxReview>, onProgress: (stage: string) => void = () => {}): Promise<ConfirmedTx> {
  const publicAccount = loadPublicAccount();
  if (!publicAccount || publicAccount.address.toLowerCase() !== address.toLowerCase())
    throw new Error("Sign in to this wallet again before trading.");
  const checkRefreshed = (current: TxReview) => {
    if (current.action !== review.action || current.chainId !== review.chainId ||
      current.amount !== review.amount ||
      current.from.toLowerCase() !== review.from.toLowerCase() ||
      current.to.toLowerCase() !== review.to.toLowerCase() ||
      current.quote?.marketId !== review.quote?.marketId ||
      current.quote?.side !== review.quote?.side ||
      current.quote?.orderType !== review.quote?.orderType ||
      current.quote?.leverageHundredths !== review.quote?.leverageHundredths ||
      current.quote?.slippageBps !== review.quote?.slippageBps ||
      current.quote?.timeInForce !== review.quote?.timeInForce ||
      current.quote?.quantity !== review.quote?.quantity ||
      current.quote?.worstPrice !== review.quote?.worstPrice)
      throw new Error("Trade terms changed. Review the updated market price before signing.");
    const approvedNetworkFeeCap = Number(review.maxNetworkFee) * (review.quote?.orderType === "market" ? 1.5 : 1);
    if (Number(current.maxNetworkFee) > approvedNetworkFeeCap)
      throw new Error("Network fee increased. Review the updated fee before signing.");
  };
  // Refresh once after authentication, preserving the reviewed trade terms.
  onProgress("Confirm with your passkey…");
  const privateKey = await withDeadline(chooseSpecificFromExisting(publicAccount), 30_000, "Passkey confirmation expired. Please try again.", key => key.fill(0));
  const session = await createSigningSession(privateKey);
  try {
    if (getEvmAddress(session.publicKey).toLowerCase() !== address.toLowerCase())
      throw new Error("The selected passkey belongs to another wallet.");
    onProgress("Checking order…");
    const current = refreshReview ? await withDeadline(refreshReview(), 30_000, "Order preparation took too long. Check your connection and try again.") : review;
    if (refreshReview) checkRefreshed(current);
    onProgress("Signing…");
    await withDeadline(signTransactionDigest(current.id, session, current.digest), 15_000, "Signing did not finish. Please try again.");
    onProgress("Waiting for onchain confirmation…");
    const hash = await broadcastTransaction(current.id, current.action);
    let outcome: OrderOutcome | null = null;
    if (current.action === "order" || current.action === "close") {
      try { outcome = await withDeadline(inspectOrderResult(hash), 5_000, "Fill details are syncing"); }
      catch { /* The receipt is confirmed; account and activity can still supply the fill result. */ }
    }
    return { hash, outcome };
  } finally { session.end(); }
}
