import { ToastNotice } from "../notifications/ToastHost";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import { ArrowDownIcon, ArrowUpRightIcon, ChevronDownIcon, FingerprintIcon, Loader2Icon, RefreshCwIcon, XIcon } from "lucide-react";
import { TradingSetupBanner, useTradingSetup } from "../components/TradingSetup";
import { AppTabs, type AppTab } from "../components/AppTabs";
import { loadPublicAccount } from "../utils/storageSaveAndLoad";
import { errorText } from "../utils/errorText";
import { LiveChart, preferredChartInterval, type ChartLevel } from "../trading/LiveChart";
import { useTradingData } from "../trading/useTradingData";
import { acknowledgeTransaction, authorizeAndSend, buildCancel, buildChange, buildClose, buildForwarding, buildFunding, buildOrder, cancelTrigger, connectWalletData, forgetWalletDataAccess, getAccount, getActivity,
  hasWalletDataAccess, inspectOrderResult, pendingTriggers, placeTrigger, previewClose, previewOrder, previewTrigger, reconcileTrigger, recoverPendingTransactions, watchPrivateFeed,
  type Activity, type CloseInput, type FundingAction, type OpenOrder, type OrderInput, type OrderOutcome, type OrderQuote, type PendingTrigger, type TriggerInput, type TriggerPreview, type TxReview } from "../trading/service";

const number = (value: string | number | null | undefined, digits = 2) => {
  if (value == null || value === "") return "—";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(parsed) : "—";
};
const money = (value: string | number | null | undefined) => `$${number(value)}`;
const signedMoney = (value: number) => `${value >= 0 ? "+" : "−"}$${number(Math.abs(value))}`;
const slippageStorageKey = "exora.perpl.preferredSlippageBps";
const loadPreferredSlippage = () => {
  try {
    const value = Number(localStorage.getItem(slippageStorageKey));
    return Number.isInteger(value) && value >= 1 && value < 10_000 ? value : 1000;
  } catch { return 1000; }
};
const isMarketPriceChange = (message: string) =>
  /market moved beyond|increase your reviewed USD size|order quote expired|could not post this order at the chosen price and size/i.test(message);
const resultMessage = (action: string, result: OrderOutcome | null, symbol?: string) => {
  if (action === "cancel") return "Order cancellation confirmed on Monad.";
  if (action === "change") return "Order update confirmed on Monad.";
  if (action !== "order" && action !== "close") return "Transaction confirmed on Monad.";
  if (!result || result.status === "unknown") return "Order confirmed on Monad. The fill is syncing; check your position and Activity.";
  const unit = symbol ?? "units";
  if (result.status === "unfilled") return "No fill. The order reached Monad, but available liquidity did not meet its price limit.";
  if (result.status === "resting") return `Order confirmed and resting on the book${result.restingOrderId ? ` as #${result.restingOrderId}` : ""}.`;
  const fill = result.filled ? `${number(result.filled, 6)} ${unit}` : "Order";
  const price = result.averagePrice ? ` at an average ${money(result.averagePrice)}` : "";
  return result.status === "partiallyFilled"
    ? `Partially filled ${fill}${price}. ${number(result.remaining, 6)} ${unit} ${result.restingOrderId ? `rests on the book as #${result.restingOrderId}` : action === "close" ? "remains in the position" : "was canceled"}.`
    : `Filled ${fill}${price}.`;
};

export default function Trading() {
  const { status: setupStatus, openSetup, accountCreated } = useTradingSetup();
  const navigate = useNavigate();
  const location = useLocation();
  const tab = (location.pathname.slice(1) || "trade") as AppTab;
  const address = loadPublicAccount()?.address ?? null;
  const [marketId, setMarketId] = useState<number>(() => (location.state as { marketId?: number } | null)?.marketId ?? 16);
  const [resolution, setResolution] = useState(preferredChartInterval);
  const [showVolume, setShowVolume] = useState(true);
  const [portfolioSection, setPortfolioSection] = useState<"positions" | "orders">(() =>
    (location.state as { portfolioSection?: string } | null)?.portfolioSection === "orders" ? "orders" : "positions");
  useEffect(() => {
    const section = (location.state as { portfolioSection?: string } | null)?.portfolioSection;
    if (section === "positions" || section === "orders") setPortfolioSection(section);
  }, [location.key]);
  const [marketMenu, setMarketMenu] = useState(false);
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [timeInForce, setTimeInForce] = useState<OrderInput["timeInForce"]>("gtc");
  const [size, setSize] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [leverage, setLeverage] = useState(200);
  const [slippage, setSlippage] = useState(loadPreferredSlippage);
  const [slippageOpen, setSlippageOpen] = useState(false);
  const [customSlippage, setCustomSlippage] = useState("");
  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [orderInput, setOrderInput] = useState<OrderInput | null>(null);
  const [closeInput, setCloseInput] = useState<CloseInput | null>(null);
  const [closeDraft, setCloseDraft] = useState<{ marketId: number; symbol: string; size: string } | null>(null);
  const [closeAmount, setCloseAmount] = useState("");
  const [closeMode, setCloseMode] = useState<"market" | "limit">("market");
  const [closeLimitPrice, setCloseLimitPrice] = useState("");
  const [review, setReview] = useState<TxReview | null>(null);
  const [previousWorstPrice, setPreviousWorstPrice] = useState<string | null>(null);
  const [txHash, setTxHash] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const seenConfirmedTransactions = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const openTransactionExplorer = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isTauri()) return;
    event.preventDefault();
    void openUrl(event.currentTarget.href).catch(() => setNotice("Could not open Monad Explorer. Please try again."));
  };
  const [error, setError] = useState("");
  const [dismissedAccountError, setDismissedAccountError] = useState("");
  const [dismissedWalletDataError, setDismissedWalletDataError] = useState("");
  const [fundingOpen, setFundingOpen] = useState(false);
  const [fundingAction, setFundingAction] = useState<"deposit" | "withdraw">("deposit");
  const [fundingAmount, setFundingAmount] = useState("");
  const [activity, setActivity] = useState<Activity[]>([]);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [walletData, setWalletData] = useState<boolean | null>(null);
  const [walletDataBusy, setWalletDataBusy] = useState(false);
  const [walletDataError, setWalletDataError] = useState("");
  const [privateStatus, setPrivateStatus] = useState("connecting");
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [cancelInput, setCancelInput] = useState<{ marketId: number; orderId: number } | null>(null);
  const [changeInput, setChangeInput] = useState<{ marketId: number; orderId: number; price: string; size: string } | null>(null);
  const [editOrder, setEditOrder] = useState<{ marketId: number; orderId: number; symbol: string; price: string; size: string } | null>(null);
  const [triggerSetup, setTriggerSetup] = useState<TxReview | null>(null);
  const [signingStage, setSigningStage] = useState("");
  const [forwardingAllowed, setForwardingAllowed] = useState<boolean | null>(null);
  const [triggerDraft, setTriggerDraft] = useState<TriggerInput | null>(null);
  const [triggerReview, setTriggerReview] = useState<TriggerPreview | null>(null);
  const [pendingProtection, setPendingProtection] = useState<PendingTrigger[]>([]);
  const { markets, candles, status, account, accountError, setAccount, loadHistory, historyLoading, historyError, canLoadOlder } = useTradingData(address, marketId, resolution);
  useEffect(() => {
    if (account?.exists) accountCreated();
  }, [account?.exists, accountCreated]);
  useEffect(() => {
    const state = location.state as { setupAction?: string } | null;
    if (state?.setupAction !== "createAccount") return;
    setFundingAction("deposit");
    setFundingOpen(true);
    setError("");
    const { setupAction: _, ...rest } = state;
    navigate(location.pathname, { replace: true, state: rest });
  }, [location.key, location.state, location.pathname, navigate]);
  const marketList = useMemo(() => Object.values(markets).sort((a, b) => a.id - b.id), [markets]);
  const market = markets[marketId];
  const chartLevels = useMemo<ChartLevel[]>(() => {
    const result: ChartLevel[] = [];
    if (!market) return result;
    if (Number(market.markPrice) > 0) result.push({id: "mark", price: Number(market.markPrice), label: "Mark", color: "#d6ba7f"});
    const position = account?.positions.find(p => p.marketId === marketId);
    if (position) result.push({id: "entry", price: Number(position.entryPrice), label: `${position.side === "long" ? "Long" : "Short"} entry`, color: "#79b5ff", onSelect: () => {
      setCloseDraft({marketId, symbol: position.symbol, size: position.size});setCloseAmount(position.size);setCloseMode("market");setCloseLimitPrice("");setError("");
    }});
    for (const order of openOrders.filter(o => o.marketId === marketId)) {
      const protectedOrder = order.status === 8 || order.triggerPriceRaw !== null;
      const value = protectedOrder ? order.triggerPriceRaw : order.priceRaw;
      if (value === null) continue;
      const price = Number(value) / 10 ** market.priceDecimals;
      const takeProfit = position && order.triggerCondition != null ? (position.side === "long" ? order.triggerCondition === 3 : order.triggerCondition === 4) : null;
      result.push({id: `order:${order.orderId}`, price, color: protectedOrder ? takeProfit ? "#77eac4" : "#ff8b9a" : "#baa5ff",
        label: protectedOrder ? takeProfit === null ? "Trigger" : takeProfit ? "Take profit" : "Stop loss" : `Limit #${order.orderId}`,
        onSelect: () => {
          if (protectedOrder || !order.contractOrderId || !order.sizeRaw) {navigate("/portfolio", {state: {portfolioSection: "orders"}});return;}
          setEditOrder({marketId, orderId: order.contractOrderId, symbol: market.symbol, price:String(price),size:String(Number(order.sizeRaw)/10**market.sizeDecimals)});setError("");
        }});
    }
    return result;
  }, [market, marketId, account, openOrders, navigate]);
  const maxLeverage = market?.maxLeverageHundredths ?? 100;
  const selectedLeverage = Math.min(leverage, maxLeverage);
  const maxSlippageBps = 9999;
  const selectedSlippage = slippage;
  const slippageChoices = [100, 200, 300, 500, 1000, 2500];
  const customSlippageBps = Math.round(Number(customSlippage) * 100);
  const customSlippageValid = /^\d+(?:\.\d{1,2})?$/.test(customSlippage)
    && customSlippageBps >= 1 && customSlippageBps <= maxSlippageBps;

  useEffect(() => { if (!address) navigate("/", { replace: true }); }, [address, navigate]);
  useEffect(() => { try { localStorage.setItem(slippageStorageKey, String(slippage)); } catch { /* Preference remains available in this session. */ } }, [slippage]);
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<{ state: string }>("transaction-status", event => {
      if (!active) return;
      if (event.payload.state === "submitted") {
        setNotice("Transaction submitted to Monad. Waiting for confirmation…");
      } else if (event.payload.state === "failed") {
        setNotice("");
        setError("Transaction failed on Monad.");
      }
    }).then(cleanup => { if (active) unlisten = cleanup; else cleanup(); });
    return () => { active = false; unlisten?.(); };
  }, []);
  useEffect(() => {
    if (!address) return;
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const statuses = await recoverPendingTransactions(address);
        if (!active) return;
        setPendingCount(statuses.filter(item => item.state === "pending").length);
        for (const item of statuses) {
          if (!item.hash || item.state === "pending") continue;
          if (seenConfirmedTransactions.current.has(item.hash)) {
            await acknowledgeTransaction(address, item.hash);
            continue;
          }
          seenConfirmedTransactions.current.add(item.hash);
          const outcome = item.state === "confirmed" && (item.action === "order" || item.action === "close")
            ? await inspectOrderResult(item.hash).catch(() => null) : null;
          if (!active) return;
          setTxHash(item.state === "confirmed" ? item.hash : "");
          setNotice(item.state === "failed" ? "A pending transaction failed on Monad." : resultMessage(item.action, outcome, outcome?.marketId ? markets[outcome.marketId]?.symbol : undefined));
          await acknowledgeTransaction(address, item.hash);
          void refreshAccount();
        }
      } catch { /* Keep pending state until the next connection check. */ }
      finally { checking = false; }
    };
    void check();
    const timer = setInterval(() => void check(), 12_000);
    return () => { active = false; clearInterval(timer); };
  // Recovery only needs the signed-in wallet; the latest market/account views are refreshed separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);
  useEffect(() => { if (market && leverage > market.maxLeverageHundredths) setLeverage(market.maxLeverageHundredths); }, [market, leverage]);
  useEffect(() => {
    if (!address) return;
    let active = true;
    setForwardingAllowed(null);
    void pendingTriggers(address).then(items => { if (active) setPendingProtection(items); }).catch(() => {});
    return () => { active = false; };
  }, [address]);
  useEffect(() => {
    if (!address) return;
    let active = true;
    setWalletData(null); setActivity([]); setActivityCursor(null); setOpenOrders([]);
    void hasWalletDataAccess(address).then(value => { if (active) setWalletData(value); })
      .catch(cause => { if (active) { setWalletData(false); setWalletDataError(errorText(cause)); } });
    return () => { active = false; };
  }, [address]);
  useEffect(() => {
    if (!address || !walletData) { setOpenOrders([]); return; }
    let active = true;
    let stop: (() => void) | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;
    void watchPrivateFeed(address, event => {
      if (!active) return;
      if (event.type === "status") {
        setPrivateStatus(event.state);
        setWalletDataError(event.state === "reconnecting" ? errorText(event.message ?? "Reconnecting wallet data…") : "");
      } else if (event.type === "orders") setOpenOrders(event.orders);
      else if (event.type === "forwarding") setForwardingAllowed(event.allowed);
      else if (event.type === "accountChanged") {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => { void getAccount(address).then(value => { if (active) setAccount(value); }).catch(() => {}); }, 900);
      }
    }).then(cleanup => { if (active) stop = cleanup; else cleanup(); })
      .catch(cause => { if (active) setWalletDataError(errorText(cause)); });
    void listen<{ message: string }>("perpl-trade-notification", event => {
      if (active) setNotice(errorText(event.payload.message));
    }).then(cleanup => { if (active) unlisten = cleanup; else cleanup(); });
    return () => { active = false; if (refreshTimer) clearTimeout(refreshTimer); stop?.(); unlisten?.(); };
  }, [address, walletData, setAccount]);
  useEffect(() => {
    if (tab !== "activity" || !address || !walletData) return;
    let active = true;
    setActivityLoading(true);
    getActivity(address).then(page => { if (active) { setActivity(page.items); setActivityCursor(page.nextCursor); setActivityError(""); } })
      .catch(cause => { if (active) { const message = errorText(cause); setActivityError(message); if (/expired|401/i.test(message)) setWalletDataError(message); } })
      .finally(() => { if (active) setActivityLoading(false); });
    return () => { active = false; };
  }, [tab, address, walletData]);

  const connectData = async () => {
    if (!address || walletDataBusy) return;
    setWalletDataBusy(true); setWalletDataError("");
    try { await connectWalletData(address); setWalletData(true); setNotice("Perpl wallet data connected."); }
    catch (cause) { setWalletDataError(errorText(cause)); }
    finally { setWalletDataBusy(false); }
  };
  const resetDataAccess = async () => {
    if (!address) return;
    try { await forgetWalletDataAccess(address); setWalletData(false); setWalletDataError(""); setOpenOrders([]); setActivity([]); }
    catch (cause) { setWalletDataError(errorText(cause)); }
  };
  const refreshAccount = async () => { if (address) setAccount(await getAccount(address)); };
  const refreshActivity = async () => {
    if (!address || !walletData) return;
    setActivityLoading(true);
    try { const page = await getActivity(address); setActivity(page.items); setActivityCursor(page.nextCursor); setActivityError(""); }
    catch (cause) { const message = errorText(cause); setActivityError(message); if (/expired|401/i.test(message)) setWalletDataError(message); }
    finally { setActivityLoading(false); }
  };
  const loadMoreActivity = async () => {
    if (!address || !activityCursor || activityLoading) return;
    setActivityLoading(true);
    try {
      const page = await getActivity(address, activityCursor);
      setActivity(current => [...new Map([...current, ...page.items].map(item => [item.id, item])).values()]
        .sort((left, right) => right.timestampMs - left.timestampMs));
      setActivityCursor(page.nextCursor); setActivityError("");
    } catch (cause) { const message = errorText(cause); setActivityError(message); if (/expired|401/i.test(message)) setWalletDataError(message); }
    finally { setActivityLoading(false); }
  };
  const preview = async (side: "long" | "short") => {
    if (!address || !market || busy) return;
    setBusy(true); setError(""); setNotice("");
    const input: OrderInput = { address, marketId, side, orderType, sizeUsd: size.replace(/,/g, ""),
      leverageHundredths: selectedLeverage, limitPrice: orderType === "limit" ? limitPrice : null,
      slippageBps: orderType === "market" ? selectedSlippage : null,
      timeInForce: orderType === "market" ? "ioc" : timeInForce };
    try {
      const firstQuote = await previewOrder(input);
      if (input.orderType === "market") {
        try {
          const firstReview = await buildOrder(input, firstQuote);
          setQuote(firstQuote); setOrderInput(input); setCloseInput(null); setReview(firstReview); setPreviousWorstPrice(null);
        } catch (cause) {
          if (!isMarketPriceChange(errorText(cause))) throw cause;
          const nextQuote = await previewOrder(input);
          const nextReview = await buildOrder(input, nextQuote);
          setQuote(nextQuote); setOrderInput(input); setCloseInput(null); setReview(nextReview);
          setPreviousWorstPrice(firstQuote.worstPrice);
        }
      } else {
        setQuote(firstQuote); setOrderInput(input); setCloseInput(null); setPreviousWorstPrice(null);
      }
    }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const prepareOrder = async () => {
    if ((!orderInput && !closeInput) || !quote || busy) return;
    setBusy(true); setError("");
    try { setReview(orderInput ? await buildOrder(orderInput, quote) : await buildClose(closeInput!, quote)); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const refreshQuote = async () => {
    if ((!orderInput && !closeInput) || busy) return;
    setBusy(true); setError("");
    try { setQuote(orderInput ? await previewOrder(orderInput) : await previewClose(closeInput!)); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const previewPositionClose = async () => {
    if (!address || !closeDraft || busy) return;
    const input: CloseInput = { address, marketId: closeDraft.marketId, slippageBps: slippage,
      quantity: closeAmount === closeDraft.size ? null : closeAmount,
      limitPrice: closeMode === "limit" ? closeLimitPrice : null };
    setBusy(true); setError("");
    try {
      const firstQuote = await previewClose(input);
      try {
        const firstReview = await buildClose(input, firstQuote);
        setQuote(firstQuote); setCloseInput(input); setOrderInput(null); setReview(firstReview); setPreviousWorstPrice(null); setCloseDraft(null);
      } catch (cause) {
        if (!isMarketPriceChange(errorText(cause))) throw cause;
        const nextQuote = await previewClose(input);
        const nextReview = await buildClose(input, nextQuote);
        setQuote(nextQuote); setCloseInput(input); setOrderInput(null); setReview(nextReview); setCloseDraft(null);
        setPreviousWorstPrice(firstQuote.worstPrice);
      }
    }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const prepareCancel = async (marketId: number, orderId: number) => {
    if (!address || busy) return;
    setBusy(true); setError("");
    try {
      setReview(await buildCancel(address, marketId, orderId));
      setCancelInput({ marketId, orderId }); setQuote(null); setOrderInput(null); setCloseInput(null);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const prepareChange = async () => {
    if (!address || !editOrder || busy) return;
    const input = { marketId: editOrder.marketId, orderId: editOrder.orderId,
      price: editOrder.price, size: editOrder.size };
    setBusy(true); setError("");
    try {
      setReview(await buildChange(address, input.marketId, input.orderId, input.price, input.size));
      setChangeInput(input); setEditOrder(null); setQuote(null); setOrderInput(null); setCloseInput(null); setCancelInput(null);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const prepareTrigger = async () => {
    if (!triggerDraft || busy) return;
    setBusy(true); setError("");
    setSigningStage("Preparing…");
    try {
      const preview = await previewTrigger(triggerDraft);
      const setup = forwardingAllowed === true ? null : await buildForwarding(triggerDraft.address);
      setTriggerSetup(setup); setTriggerReview(preview);
    }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const submitTrigger = async () => {
    if (!triggerDraft || !triggerReview || busy) return;
    setBusy(true); setError("");
    try {
      setSigningStage("Confirm with your passkey…");
      const result = await placeTrigger(triggerDraft, triggerReview, triggerSetup, setSigningStage, () => { setForwardingAllowed(true); setTriggerSetup(null); });
      setForwardingAllowed(true); setTriggerSetup(null);
      setTriggerDraft(null); setTriggerReview(null);
      void pendingTriggers(triggerDraft.address).then(setPendingProtection).catch(() => {});
      setNotice(result.state === "armed" ? `Protected order #${result.orderId ?? result.requestId} is armed.`
        : result.state === "triggered" ? "Protected order triggered. Check the position and Activity for the fill."
        : `Protected order #${result.requestId} is still being confirmed by Perpl. Check Open orders before creating another.`);
    } catch (cause) {
      setNotice(""); setError(errorText(cause));
      const pending = await pendingTriggers(triggerDraft.address).catch(() => []);
      setPendingProtection(pending);
      if (pending.some(item => item.marketId === triggerDraft.marketId)) {
        setTriggerDraft(null); setTriggerReview(null); setError("");
        setNotice("Your stop is awaiting confirmation. Check its pending status before placing another.");
      }
    }
    finally { setBusy(false); }
  };
  const removeTrigger = async (order: OpenOrder) => {
    if (!address || busy) return;
    setBusy(true); setError("");
    try {
      const result = await cancelTrigger(address, order.marketId, order.orderId);
      setNotice(result.state === "canceled" ? `Protected order #${order.orderId} was canceled by Perpl.` :
        `Cancellation for protected order #${order.orderId} was received by Perpl; waiting for its order update.`);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const checkProtectedOrder = async (marketId: number) => {
    if (!address || busy) return;
    setBusy(true); setError("");
    try {
      const result = await reconcileTrigger(address, marketId);
      setPendingProtection(await pendingTriggers(address));
      setNotice(result.state === "armed" ? `Protected order #${result.orderId ?? result.requestId} is armed.`
        : result.state === "triggered" ? "Protected order triggered. Check the position and Activity for the fill."
        : "Perpl has not confirmed this protected order yet. Exora reused its original request ID to avoid a duplicate.");
    } catch (cause) { setError(errorText(cause)); void pendingTriggers(address).then(setPendingProtection).catch(() => {}); }
    finally { setBusy(false); }
  };
  const prepareFunding = async () => {
    if (!address || !account || busy) return;
    const amount = fundingAmount.trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount) || Number(amount) <= 0) {
      setError("Enter a valid AUSD amount with up to 6 decimal places."); return;
    }
    if (fundingAction === "deposit" && !account.exists && Number(amount) < Number(account.minimumOpen)) {
      setError(`Your initial deposit must be at least ${number(account.minimumOpen, 6)} AUSD. Claim testnet AUSD from Home if needed.`); return;
    }
    if (fundingAction === "deposit" && Number(amount) > Number(account.walletAusd)) {
      setError("Not enough AUSD in this wallet. Claim testnet AUSD from Home, then return to deposit."); return;
    }
    setBusy(true); setError("");
    try {
      let action: FundingAction;
      if (fundingAction === "withdraw") action = "withdraw";
      else if (Number(account.allowance) < Number(amount)) action = "approve";
      else action = account.exists ? "deposit" : "createAccount";
      setReview(await buildFunding(address, action, amount));
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const send = async () => {
    if (!review || !address || busy) return;
    setBusy(true); setError(""); setTxHash("");
    const refreshReview = orderInput && quote
      ? () => buildOrder(orderInput, quote)
      : closeInput && quote
        ? () => buildClose(closeInput, quote)
        : cancelInput
          ? () => buildCancel(address, cancelInput.marketId, cancelInput.orderId)
          : changeInput
            ? () => buildChange(address, changeInput.marketId, changeInput.orderId, changeInput.price, changeInput.size)
          : undefined;
    try {
      const confirmed = await authorizeAndSend(review, address, refreshReview, setSigningStage);
      seenConfirmedTransactions.current.add(confirmed.hash);
      setTxHash(confirmed.hash);
      const action = review.action;
      setReview(null); setQuote(null); setOrderInput(null); setCloseInput(null); setCancelInput(null); setChangeInput(null);
      setNotice(action === "approve" ? "AUSD approved on Monad." : action === "forwarding" ? "Perpl order forwarding confirmed on Monad. Waiting for Perpl to sync the permission." : resultMessage(action, confirmed.outcome, review.quote?.symbol));
      if (action === "order" || action === "close" || action === "cancel" || action === "change") void acknowledgeTransaction(address, confirmed.hash);
      if (action !== "approve") setFundingOpen(false);
      void refreshAccount().catch(() => { /* Account feed will retry; the transaction is already confirmed. */ });
      if (walletData && tab === "activity") void refreshActivity();
    } catch (cause) {
      setNotice("");
      const message = errorText(cause);
      if (/Transaction submitted/i.test(message)) {
        setError("");
        setReview(null); setQuote(null); setFundingOpen(false);
        setNotice("Transaction submitted. Confirmation is still pending; Exora will check it automatically.");
      } else {
        // Surface the failure immediately; do not keep the modal spinning through
        // another hidden round of quote preparation and simulation.
        setError(message);
        if (/trade terms changed|position changed|reviewed quote/i.test(message)) setReview(null);
      }
    } finally { setBusy(false); }
  };
  const retryReview = async () => {
    if (busy || (!orderInput && !closeInput)) return;
    setBusy(true); setError(""); setSigningStage("Refreshing order…");
    try {
      const next = orderInput ? await previewOrder(orderInput) : await previewClose(closeInput!);
      const nextReview = orderInput ? await buildOrder(orderInput, next) : await buildClose(closeInput!, next);
      setPreviousWorstPrice(quote?.worstPrice ?? null); setQuote(next); setReview(nextReview);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const closeReview = () => { if (busy) return; setReview(null); setQuote(null); setOrderInput(null); setCloseInput(null); setCancelInput(null); setChangeInput(null); setPreviousWorstPrice(null); setError(""); };
  const toastError = !quote && !review && !fundingOpen && !triggerDraft && !editOrder && !closeDraft ? error
    || (tab === "activity" ? activityError : "")
    || (accountError !== dismissedAccountError ? accountError : "")
    || (walletData && /expired|3401|unauthor|rejected access/i.test(walletDataError)
      && walletDataError !== dismissedWalletDataError ? walletDataError : "") : "";
  const visibleToastError = notice ? "" : toastError;

  if (!address) return null;
  return <div className="min-h-[100dvh] select-none bg-[#08090f] pb-[92px] font-['Geist',sans-serif] text-[#f4f3f7]">
    <header className="sticky top-0 z-20 flex h-[58px] items-center justify-between border-b border-white/10 bg-[#08090f]/90 px-5 backdrop-blur-xl" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <span className="text-lg font-semibold tracking-[0.23em]">EXORA</span>
      <span className="flex items-center gap-2 rounded-full border border-white/10 bg-[#141620] px-3 py-2 text-[11px]">
        <span className={`h-1.5 w-1.5 rounded-full ${status.state === "connected" ? "bg-[#77eac4]" : "bg-[#ff8b9a]"}`} />
        {address.slice(0, 6)}…{address.slice(-4)}
      </span>
    </header>
    <main className="mx-auto max-w-[540px] px-5 pt-4">
      <TradingSetupBanner />
      {pendingCount > 0 && <div role="status" className="mb-4 rounded-2xl border border-[#baa5ff]/25 bg-[#baa5ff]/10 px-4 py-3 text-xs text-[#dfd4ff]">{pendingCount} Perpl transaction{pendingCount === 1 ? " is" : "s are"} awaiting Monad confirmation. The hash will appear after confirmation.</div>}
      {(tab === "portfolio" || tab === "activity") && walletData === false && <section className="mb-4 rounded-[24px] border border-[#baa5ff]/25 bg-[#baa5ff]/10 p-4"><h2 className="text-sm font-medium">Connect Perpl wallet data</h2><p className="mt-1 text-xs leading-relaxed text-[#a6a7b8]">Use your passkey once to view this wallet’s open orders and history. This access is read only; trades still require your passkey.</p><button type="button" disabled={walletDataBusy} onClick={() => void connectData()} className="mt-3 rounded-xl bg-[#baa5ff] px-4 py-2.5 text-xs font-semibold text-[#08090f] disabled:opacity-50">{walletDataBusy ? "Connecting…" : "Connect wallet data"}</button>{walletDataError && <p role="alert" className="mt-2 text-xs text-[#ff9fae]">{walletDataError}</p>}</section>}
      {tab === "portfolio" && pendingProtection.map(item => <div key={`${item.marketId}:${item.requestId}`} role="status" className="mb-3 rounded-2xl border border-[#baa5ff]/30 bg-[#baa5ff]/10 p-4 text-xs"><p>Protected order #{item.requestId} for {markets[item.marketId]?.symbol ?? `market #${item.marketId}`} is awaiting Perpl’s final status.</p><button type="button" disabled={busy} onClick={() => void checkProtectedOrder(item.marketId)} className="mt-2 text-[#dfd4ff] underline disabled:opacity-40">Check status with passkey</button></div>)}
      {tab === "trade" && <>
        <div className="relative flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[#baa5ff]/20 text-sm font-semibold text-[#baa5ff]">{market?.symbol[0] ?? "?"}</span>
          <button type="button" onClick={() => setMarketMenu(!marketMenu)} aria-expanded={marketMenu} className="flex items-center gap-1 text-[22px] font-medium">
            {market?.symbol ?? "Markets"}<span className="text-base text-[#a6a7b8]">/ USD</span><ChevronDownIcon className="h-4 w-4 text-[#a6a7b8]" />
          </button>
          <span className="ml-auto rounded-full border border-white/10 bg-[#22242f] px-3 py-1.5 text-[11px] text-[#baa5ff]">PERP</span>
          {marketMenu && <div className="absolute left-0 right-0 top-12 z-20 max-h-[320px] overflow-y-auto rounded-2xl border border-white/15 bg-[#1a1c29] p-1 shadow-2xl">
            {marketList.map(item => <button key={item.id} type="button" onClick={() => { setMarketId(item.id); setMarketMenu(false); setSlippageOpen(false); setQuote(null); setSize(""); setLeverage(Math.min(200, item.maxLeverageHundredths)); }} className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left hover:bg-white/10">
              <span>{item.symbol}<span className="ml-2 text-xs text-[#a6a7b8]">{item.name}</span><span className="block text-[10px] text-[#baa5ff]">Max {number(item.maxLeverageHundredths / 100)}×</span></span><span className="text-sm">{money(item.price)}</span>
            </button>)}
          </div>}
        </div>
        <h1 className="mt-3 text-[40px] font-light leading-tight tracking-[-0.04em]">{money(market?.price)}</h1>
        <p className={`mt-1 text-xs ${Number(market?.price ?? 0) >= Number(market?.previousPrice ?? 0) ? "text-[#77eac4]" : "text-[#ff8b9a]"}`}>
          {market?.price && market?.previousPrice ? signedMoney(Number(market.price) - Number(market.previousPrice)) : "—"} · 24h
        </p>
        <div className="mt-4"><LiveChart candles={candles} symbol={market?.symbol ?? "Market"} marketId={marketId}
          priceDecimals={market?.priceDecimals ?? 2} resolution={resolution} onResolution={setResolution}
          showVolume={showVolume} onVolume={() => setShowVolume(!showVolume)} connected={status.state === "connected"}
          loading={historyLoading} error={historyError} canLoadOlder={canLoadOlder} loadHistory={loadHistory} levels={chartLevels} /></div>
        <div className="mt-2 flex justify-between gap-2 text-[10px] text-[#a6a7b8]"><span>Funding {market?.fundingRate == null ? "—" : `${number(market.fundingRate / 100_000, 4)}%`}</span><span>OI {number(market?.openInterest)}</span><span>Vol {money(market?.volumeUsd)}</span></div>
        <section aria-label="Order ticket" className="mt-4 rounded-[28px] border border-white/10 bg-[#141620] p-4 shadow-xl">
          <div className="flex items-center gap-4 text-sm">
            {(["market", "limit"] as const).map(kind => <button key={kind} type="button" onClick={() => { setOrderType(kind); setSlippageOpen(false); }} className={`capitalize ${orderType === kind ? "font-semibold text-white" : "text-[#a6a7b8]"}`}>{kind}</button>)}
            <span className="ml-auto rounded-full border border-white/10 bg-[#22242f] px-2.5 py-1.5 text-[11px] text-[#baa5ff]">Isolated {number(selectedLeverage / 100, 2)}×</span>
          </div>
          <div className="mt-4 flex items-center justify-between text-[11px]"><span className="text-[#a6a7b8]">Leverage</span><span>Max {number(maxLeverage / 100, 2)}× for {market?.symbol ?? "market"}</span></div>
          <input aria-label="Leverage" type="range" min="100" max={Math.max(100, maxLeverage)} step="1" value={selectedLeverage} onChange={event => setLeverage(Number(event.target.value))} className="mt-2 w-full accent-[#baa5ff]" />
          <div className="mt-3 flex justify-between text-[11px]"><span className="text-[#a6a7b8]">Available</span><span>{account ? `${number(account.availableBalance)} AUSD` : "Loading account…"}</span></div>
          <label className="mt-2 flex h-12 items-center gap-2 rounded-xl border border-white/10 bg-[#08090f] px-3"><span className="text-xs text-[#a6a7b8]">Size</span><input inputMode="decimal" value={size} onChange={event => setSize(event.target.value.replace(/[^0-9.,]/g, ""))} placeholder="0" className="min-w-0 flex-1 bg-transparent text-right text-lg outline-none select-text" /><span className="text-xs text-[#a6a7b8]">USD</span></label>
          {orderType === "limit" && <><label className="mt-2 flex h-12 items-center gap-2 rounded-xl border border-white/10 bg-[#08090f] px-3"><span className="text-xs text-[#a6a7b8]">Limit</span><input inputMode="decimal" value={limitPrice} onChange={event => setLimitPrice(event.target.value.replace(/[^0-9.]/g, ""))} placeholder={market?.price ?? "0"} className="min-w-0 flex-1 bg-transparent text-right text-lg outline-none select-text" /><span className="text-xs">USD</span></label></>}
          {orderType === "limit" && <div className="mt-3"><p className="mb-2 text-[11px] text-[#a6a7b8]">Time in force</p><div className="grid grid-cols-4 gap-1.5">{([["gtc", "GTC"], ["ioc", "IOC"], ["fok", "FOK"], ["postOnly", "Post only"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={timeInForce === value} onClick={() => setTimeInForce(value)} className={`rounded-xl border px-1 py-2 text-[10px] ${timeInForce === value ? "border-[#baa5ff]/60 bg-[#baa5ff]/20 text-[#e4d8ff]" : "border-white/10 text-[#a6a7b8]"}`}>{label}</button>)}</div><p className="mt-2 text-[10px] text-[#a6a7b8]">GTC rests on the book; IOC cancels unfilled size; FOK needs a full immediate fill; Post only adds liquidity without crossing.</p></div>}
          {orderType === "market" && <div className="relative mt-3 flex items-center justify-between text-[11px] text-[#a6a7b8]"><span>Slippage limit</span><button type="button" aria-haspopup="dialog" aria-expanded={slippageOpen} onClick={() => { setCustomSlippage((selectedSlippage / 100).toString()); setSlippageOpen(!slippageOpen); }} className="flex items-center gap-2 rounded-xl border border-[#baa5ff]/25 bg-white/[0.06] px-3 py-2 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-xl">{number(selectedSlippage / 100)}%<ChevronDownIcon className="h-3.5 w-3.5 text-[#baa5ff]" /></button>{slippageOpen && <><button type="button" aria-label="Close slippage picker" onClick={() => setSlippageOpen(false)} className="fixed inset-0 z-40 cursor-default" /><div role="dialog" aria-label="Choose market slippage" className="absolute bottom-full right-0 z-50 mb-2 w-full max-w-[320px] rounded-[22px] border border-[#cbbdff]/25 bg-[#1b1e2b]/95 p-4 text-white shadow-[0_20px_60px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl"><div className="flex items-center justify-between"><span className="text-sm font-medium">Slippage protection</span><button type="button" aria-label="Close" onClick={() => setSlippageOpen(false)} className="rounded-lg p-1 text-[#a6a7b8]"><XIcon className="h-4 w-4" /></button></div><p className="mt-1 text-[11px] leading-relaxed text-[#a6a7b8]">Maximum price movement you accept for this market order.</p><div className="mt-4 grid grid-cols-3 gap-2">{slippageChoices.map(choice => <button key={choice} type="button" aria-pressed={selectedSlippage === choice} onClick={() => { setSlippage(choice); setSlippageOpen(false); }} className={`h-10 rounded-xl border text-xs font-medium ${selectedSlippage === choice ? "border-[#baa5ff]/60 bg-[#baa5ff]/20 text-[#e4d8ff]" : "border-white/10 bg-white/[0.04] text-[#d1cfda]"}`}>{number(choice / 100)}%</button>)}</div><label className="mt-4 block text-[11px] text-[#a6a7b8]">Custom percentage</label><div className="mt-2 flex items-center gap-2"><div className="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-white/15 bg-[#0b0d15]/80 px-3"><input inputMode="decimal" value={customSlippage} onChange={event => setCustomSlippage(event.target.value.replace(/[^0-9.]/g, ""))} aria-label="Custom slippage percentage" placeholder="0.00" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none select-text" /><span className="text-xs text-[#a6a7b8]">%</span></div><button type="button" disabled={!customSlippageValid} onClick={() => { setSlippage(customSlippageBps); setSlippageOpen(false); }} className="h-11 rounded-xl bg-[#baa5ff] px-4 text-xs font-semibold text-[#08090f] disabled:opacity-40">Apply</button></div><p className="mt-3 text-[10px] text-[#a6a7b8]">Enter a custom price tolerance from 0.01% to 99.99%.</p></div></>}</div>}
          {error && <p role="alert" className="mt-3 text-xs text-[#ff8b9a]">{error}</p>}
          <div className="mt-4 flex gap-2.5"><button type="button" disabled={busy || !account?.exists || !market?.isOpen || !size} onClick={() => void preview("long")} className="h-[46px] flex-1 rounded-2xl bg-[#77eac4] text-sm font-semibold text-[#07120e] disabled:opacity-40">↗ Long / Buy</button><button type="button" disabled={busy || !account?.exists || !market?.isOpen || !size} onClick={() => void preview("short")} className="h-[46px] flex-1 rounded-2xl bg-[#ff8b9a] text-sm font-semibold text-[#180b0e] disabled:opacity-40">↘ Short / Sell</button></div>
          {(account?.exists === false || setupStatus?.exists === false) && <button type="button" onClick={openSetup} className="mt-3 min-h-11 w-full rounded-xl border border-[#baa5ff]/30 bg-[#baa5ff]/10 text-sm font-medium text-[#baa5ff]">Set up trading →</button>}
        </section>
        {account?.positions?.length ? <button type="button" onClick={() => navigate("/portfolio")} className="mt-3 flex w-full items-center justify-between rounded-2xl border border-white/10 bg-[#141620] px-4 py-3 text-left text-xs"><span>{account.positions.length} open position{account.positions.length === 1 ? "" : "s"}</span><span className="text-[#baa5ff]">View portfolio →</span></button> : null}
      </>}
      {tab === "portfolio" && <>
        <div className="flex items-center justify-between"><h1 className="text-[27px] font-light">Your portfolio</h1><span className="rounded-full border border-white/10 bg-[#22242f] px-3 py-1.5 text-xs">AUSD</span></div>
        <section className="mt-5 rounded-[28px] border border-white/10 bg-[#141620] px-5 py-6 shadow-xl"><p className="text-[10px] font-medium tracking-widest text-[#a6a7b8]">PERPL ACCOUNT BALANCE</p><p className="mt-2 text-[38px] font-light">{account ? money(account.balance) : "—"}</p><p className="mt-3 text-xs text-[#a6a7b8]">{account?.exists ? `Account #${account.accountId} · Monad testnet` : account ? "No Perpl account yet" : "Checking your Perpl account…"}</p></section>
        <div className="mt-3 grid grid-cols-2 gap-3">{[{ label: "Available", value: account?.availableBalance }, { label: "Locked margin", value: account?.committedMargin }].map(item => <div key={item.label} className="rounded-[18px] border border-white/10 bg-[#141620] px-4 py-4"><p className="text-[11px] text-[#a6a7b8]">{item.label}</p><p className="mt-1 text-xl font-medium">{money(item.value)}</p></div>)}</div>
        <p className="mt-3 text-xs text-[#a6a7b8]">Wallet AUSD: {account ? number(account.walletAusd) : "—"}</p>
        <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" onClick={() => { if (!account?.exists && (!setupStatus?.hasMon || !setupStatus?.hasAusd)) { openSetup(); return; } setFundingAction("deposit"); setFundingOpen(true); setError(""); }} className="h-12 rounded-2xl border border-[#baa5ff]/30 bg-[#baa5ff]/15 text-sm font-medium text-[#baa5ff]"><ArrowDownIcon className="mr-1 inline h-4 w-4" />{account?.exists ? "Deposit" : "Create account"}</button><button type="button" disabled={!account?.exists} onClick={() => { setFundingAction("withdraw"); setFundingOpen(true); setError(""); }} className="h-12 rounded-2xl border border-white/10 bg-[#22242f] text-sm font-medium disabled:opacity-40"><ArrowUpRightIcon className="mr-1 inline h-4 w-4" />Withdraw</button></div>
        <div role="tablist" aria-label="Portfolio holdings" className="mt-7 grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-[#141620]/80 p-1 backdrop-blur-xl">
          {(["positions", "orders"] as const).map(section => <button key={section} type="button" role="tab"
            id={`portfolio-${section}-tab`} aria-controls={`portfolio-${section}-panel`} aria-selected={portfolioSection === section}
            tabIndex={portfolioSection === section ? 0 : -1} onClick={() => setPortfolioSection(section)}
            onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? "positions" : event.key === "End" ? "orders" : section === "positions" ? "orders" : "positions";
              setPortfolioSection(next);
              document.getElementById(`portfolio-${next}-tab`)?.focus();
            }}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[#baa5ff] ${portfolioSection === section ? "border border-[#baa5ff]/25 bg-[#baa5ff]/15 text-[#dfd4ff] shadow-sm" : "border border-transparent text-[#a6a7b8] hover:bg-white/5"}`}>
            {section === "positions" ? "Open Positions" : "Open Orders"}
            <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] tabular-nums">{section === "positions" ? account?.positions.length ?? 0 : openOrders.length}</span>
          </button>)}
        </div>
        <section role="tabpanel" id="portfolio-positions-panel" aria-labelledby="portfolio-positions-tab" hidden={portfolioSection !== "positions"}>
        {account?.positions.length ? <div className="mt-3 space-y-3">{account.positions.map(position => <article key={position.marketId} className="rounded-[24px] border border-white/10 bg-[#141620] p-4"><div className="flex justify-between"><div><p className="font-medium">{position.symbol} perpetual</p><p className={`mt-1 text-[10px] uppercase ${position.side === "long" ? "text-[#77eac4]" : "text-[#ff8b9a]"}`}>{position.side} · {number(position.size, 6)} {position.symbol}</p></div><span className={Number(position.pnl) >= 0 ? "text-[#77eac4]" : "text-[#ff8b9a]"}>{signedMoney(Number(position.pnl))}</span></div><div className="mt-4 flex justify-between text-xs"><span className="text-[#a6a7b8]">Entry / Mark</span><span>{money(position.entryPrice)} / {money(position.markPrice)}</span></div><div className="mt-2 flex justify-between text-xs"><span className="text-[#a6a7b8]">Position margin</span><span>{money(position.deposit)}</span></div><button type="button" disabled={busy} onClick={() => { setCloseDraft({ marketId: position.marketId, symbol: position.symbol, size: position.size }); setCloseAmount(position.size); setCloseMode("market"); setCloseLimitPrice(""); setError(""); }} className="mt-4 h-10 w-full rounded-xl border border-[#ff8b9a]/30 text-xs font-medium text-[#ff9fae] disabled:opacity-50">Review close position</button><button type="button" disabled={busy} onClick={() => { setTriggerDraft({ address, marketId: position.marketId, kind: "stopLoss", triggerPrice: "", quantity: position.size, limitPrice: null, slippageBps: slippage }); setTriggerReview(null); setError(""); }} className="mt-2 h-10 w-full rounded-xl border border-[#baa5ff]/30 text-xs font-medium text-[#baa5ff] disabled:opacity-40">Stop loss / Take profit</button></article>)}</div> : <div className="mt-3 rounded-[24px] border border-white/10 bg-[#141620] px-5 py-8 text-center text-sm text-[#a6a7b8]">{account ? "No open positions." : "Loading positions…"}</div>}
        </section>
        <section role="tabpanel" id="portfolio-orders-panel" aria-labelledby="portfolio-orders-tab" hidden={portfolioSection !== "orders"}>
        {walletData ? openOrders.length ? <div className="mt-3 space-y-3">{openOrders.map(order => {
          const item = markets[order.marketId];
          const size = order.sizeRaw && item ? Number(order.sizeRaw) / 10 ** item.sizeDecimals : null;
          const price = order.priceRaw && item ? Number(order.priceRaw) / 10 ** item.priceDecimals : null;
          const protectedOrder = order.status === 8 || order.triggerPriceRaw !== null;
          const trigger = order.triggerPriceRaw && item ? Number(order.triggerPriceRaw) / 10 ** item.priceDecimals : null;
          const side = account?.positions.find(position => position.marketId === order.marketId)?.side;
          const isTakeProfit = side && order.triggerCondition != null
            ? (side === "long" ? order.triggerCondition === 3 : order.triggerCondition === 4) : null;
          return <article key={`${order.marketId}:${order.orderId}`} className="rounded-[24px] border border-white/10 bg-[#141620] p-4">
            <div className="flex items-center justify-between"><div><p className="text-sm font-medium">{item?.symbol ?? `Market #${order.marketId}`} {protectedOrder ? isTakeProfit === null ? "trigger order" : isTakeProfit ? "take profit" : "stop loss" : "limit order"}</p><p className="mt-1 text-[11px] text-[#a6a7b8]">#{order.orderId} · {protectedOrder ? "Waiting for mark price" : order.status === 3 ? "Partially filled" : "Open"}</p></div><p className="text-sm">{protectedOrder ? trigger == null ? "—" : money(trigger) : price == null ? "—" : money(price)}</p></div>
            {protectedOrder && <p className="mt-2 text-[11px] text-[#baa5ff]">Triggers when mark {order.triggerCondition === 3 ? "≥" : "≤"} {trigger == null ? "—" : money(trigger)} · linked to this position</p>}
            <p className="mt-3 text-xs text-[#a6a7b8]">{size == null ? "—" : number(size, 6)} {item?.symbol ?? "units"} {protectedOrder ? "protected" : "remaining"}</p>
            {protectedOrder ? <button type="button" disabled={busy || privateStatus !== "connected"} onClick={() => void removeTrigger(order)} className="mt-4 h-10 w-full rounded-xl border border-[#ff8b9a]/30 text-xs font-medium text-[#ff9fae] disabled:opacity-50">Cancel protected order</button>
              : <><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" disabled={busy || privateStatus !== "connected" || !order.contractOrderId || price == null || size == null} onClick={() => { if (order.contractOrderId && price != null && size != null) { setEditOrder({ marketId: order.marketId, orderId: order.contractOrderId, symbol: item?.symbol ?? "units", price: String(price), size: String(size) }); setError(""); } }} className="h-10 rounded-xl border border-[#baa5ff]/30 text-xs font-medium text-[#baa5ff] disabled:opacity-50">Edit order</button><button type="button" disabled={busy || privateStatus !== "connected" || !order.contractOrderId} onClick={() => { if (order.contractOrderId) void prepareCancel(order.marketId, order.contractOrderId); }} className="h-10 rounded-xl border border-[#ff8b9a]/30 text-xs font-medium text-[#ff9fae] disabled:opacity-50">Cancel order</button></div>{!order.contractOrderId && <p className="mt-2 text-[11px] text-[#ffb3be]">Contract order ID is unavailable. Refresh wallet data before canceling.</p>}</>}
          </article>;
        })}</div> : <div className="mt-3 rounded-[24px] border border-white/10 bg-[#141620] px-5 py-8 text-center text-sm text-[#a6a7b8]">{privateStatus === "connected" ? "No open orders." : "Syncing open orders…"}</div> : <p className="mt-3 text-xs text-[#a6a7b8]">{walletData === null ? "Checking wallet data…" : "Connect wallet data to view open orders."}</p>}
        </section>
      </>}
      {tab === "activity" && <>
        <div className="flex items-center justify-between"><h1 className="text-[27px] font-light">Activity</h1><button type="button" onClick={() => void refreshActivity()} disabled={!walletData || activityLoading} aria-label="Refresh activity" className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-[#22242f] text-[#baa5ff] disabled:opacity-40"><RefreshCwIcon className={`h-4 w-4 ${activityLoading ? "animate-spin" : ""}`} /></button></div>
        <p className="mt-2 text-xs text-[#a6a7b8]">Orders, fills, positions, and account updates for this wallet.</p>
        {txHash && <a href={`https://testnet.monadexplorer.com/tx/${encodeURIComponent(txHash)}`} target="_blank" rel="noopener noreferrer" draggable={false} onClick={openTransactionExplorer} className="mt-3 block w-full truncate rounded-xl border border-white/10 px-3 py-2 text-left font-mono text-[10px] text-[#a6a7b8]">Latest tx {txHash} · view on explorer</a>}
        {walletData && !activityLoading && !activity.length && activityError && <div className="mt-6 rounded-[24px] border border-white/10 bg-[#141620] px-5 py-6 text-sm text-[#a6a7b8]">Activity could not be loaded.<button type="button" onClick={() => void refreshActivity()} className="mt-3 block text-xs text-[#baa5ff] underline">Try again</button></div>}
        {walletData && activityLoading && !activity.length && <div className="mt-6 flex items-center gap-2 text-sm text-[#a6a7b8]"><Loader2Icon className="h-4 w-4 animate-spin" />Loading wallet activity…</div>}
        {walletData && !activityLoading && !activity.length && !activityError && <div className="mt-6 rounded-[28px] border border-white/10 bg-[#141620] px-6 py-10 text-center"><p className="font-medium">No activity yet</p><p className="mt-2 text-xs text-[#a6a7b8]">Orders and account updates appear here after confirmation.</p></div>}
        {walletData && activity.length > 0 && <ul className="mt-5 overflow-hidden rounded-[28px] border border-white/10 bg-[#141620] px-4">{activity.map(item => <li key={item.id} className="flex items-center gap-3 border-b border-white/10 py-4 last:border-0"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#baa5ff]/10 text-[#baa5ff]">{item.kind.includes("withdraw") ? "↗" : "↙"}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium capitalize">{item.kind} {item.symbol ?? "AUSD"}</p><p className="mt-1 text-[10px] text-[#a6a7b8]">{item.side ? `${item.side} · ` : ""}{item.timestampMs ? new Date(item.timestampMs).toLocaleString() : `Block ${item.blockNumber}`}</p>{item.transactionHash && <a href={`https://testnet.monadexplorer.com/tx/${encodeURIComponent(item.transactionHash)}`} target="_blank" rel="noopener noreferrer" draggable={false} onClick={openTransactionExplorer} aria-label={`View transaction ${item.transactionHash} on Monad Explorer`} className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-[#baa5ff]"><ArrowUpRightIcon className="h-3 w-3" />{item.transactionHash.slice(0, 10)}…</a>}</div><div className="text-right"><p className="text-xs">{item.amount ? `${number(item.amount, 6)} ${item.symbol ?? "AUSD"}` : "—"}</p>{item.price && <p className="mt-1 text-[10px] text-[#a6a7b8]">@ {money(item.price)}</p>}</div></li>)}</ul>}
        {walletData && activityCursor && <button type="button" disabled={activityLoading} onClick={() => void loadMoreActivity()} className="mt-4 h-11 w-full rounded-xl border border-white/10 text-xs text-[#baa5ff] disabled:opacity-40">{activityLoading ? "Loading…" : "Load more"}</button>}
      </>}
    </main>
    <AppTabs active={tab} />
    <ToastNotice message={visibleToastError || notice} kind={visibleToastError || /could not|failed/i.test(notice) ? "error" : /submitted|pending|waiting|syncing/i.test(notice) ? "info" : "success"}
      title={visibleToastError || /could not|failed/i.test(notice) ? "Unable to complete" : /copied/i.test(notice) ? "Copied to clipboard" : /submitted|pending|waiting|syncing/i.test(notice) ? "Keeping you updated" : /filled|confirmed/i.test(notice) ? "Transaction confirmed" : "All set"}
      action={visibleToastError === walletDataError && !!walletDataError && /expired|3401|unauthor|rejected access/i.test(walletDataError)
        ? { label: "Reconnect access", run: () => { void resetDataAccess(); } }
        : !visibleToastError && txHash && /transaction|confirmed|cancellation|approved/i.test(notice)
          ? { label: "Copy transaction hash", run: () => { void navigator.clipboard.writeText(txHash).then(() => setNotice("Transaction hash copied.")).catch(() => setNotice("Could not copy transaction hash.")); } } : undefined}
      onDismiss={() => { if (visibleToastError === error && visibleToastError) setError(""); else if (visibleToastError === activityError && visibleToastError) setActivityError(""); else if (visibleToastError === accountError && visibleToastError) setDismissedAccountError(accountError); else if (visibleToastError === walletDataError && visibleToastError) setDismissedWalletDataError(walletDataError); else setNotice(""); }} />
    {triggerDraft && <div role="dialog" aria-modal="true" aria-label="Set protected order" className="fixed inset-0 z-40 flex items-end justify-center bg-black/75 px-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:items-center"><div className="max-h-[calc(100dvh-24px)] w-full max-w-[500px] overflow-y-auto scrollbar-hidden rounded-[28px] border border-white/15 bg-[#141620] p-5"><div className="flex items-center justify-between"><h2 className="text-[23px] font-light">Protect {markets[triggerDraft.marketId]?.symbol ?? "position"}</h2><button type="button" disabled={busy} onClick={() => { setTriggerDraft(null); setTriggerReview(null); setError(""); }} aria-label="Dismiss protected order"><XIcon className="h-5 w-5" /></button></div><p className="mt-2 text-xs leading-relaxed text-[#a6a7b8]">Perpl watches the mark price while the app is closed. A trigger starts an order; it does not guarantee a fill.</p><div className="mt-4 grid grid-cols-2 gap-2">{(["stopLoss", "takeProfit"] as const).map(kind => <button key={kind} type="button" aria-pressed={triggerDraft.kind === kind} onClick={() => { setTriggerDraft({ ...triggerDraft, kind }); setTriggerReview(null); }} className={`h-10 rounded-xl border text-xs ${triggerDraft.kind === kind ? "border-[#baa5ff]/60 bg-[#baa5ff]/20 text-[#e4d8ff]" : "border-white/10 text-[#a6a7b8]"}`}>{kind === "stopLoss" ? "Stop loss" : "Take profit"}</button>)}</div><label className="mt-4 flex h-12 items-center gap-2 rounded-xl border border-white/10 bg-[#08090f] px-3"><span className="text-xs text-[#a6a7b8]">Trigger mark</span><input inputMode="decimal" value={triggerDraft.triggerPrice} onChange={event => { setTriggerDraft({ ...triggerDraft, triggerPrice: event.target.value.replace(/[^0-9.]/g, "") }); setTriggerReview(null); }} className="min-w-0 flex-1 bg-transparent text-right text-lg outline-none select-text" /><span className="text-xs">USD</span></label><label className="mt-3 flex h-12 items-center gap-2 rounded-xl border border-white/10 bg-[#08090f] px-3"><span className="text-xs text-[#a6a7b8]">Close size</span><input inputMode="decimal" value={triggerDraft.quantity} onChange={event => { setTriggerDraft({ ...triggerDraft, quantity: event.target.value.replace(/[^0-9.]/g, "") }); setTriggerReview(null); }} className="min-w-0 flex-1 bg-transparent text-right text-lg outline-none select-text" /><span className="text-xs">{markets[triggerDraft.marketId]?.symbol ?? "units"}</span></label><div className="mt-4 grid grid-cols-2 gap-2">{(["market", "limit"] as const).map(kind => <button key={kind} type="button" aria-pressed={(triggerDraft.limitPrice === null) === (kind === "market")} onClick={() => { setTriggerDraft({ ...triggerDraft, limitPrice: kind === "market" ? null : "" }); setTriggerReview(null); }} className={`h-10 rounded-xl border text-xs ${(triggerDraft.limitPrice === null) === (kind === "market") ? "border-[#baa5ff]/60 bg-[#baa5ff]/20 text-[#e4d8ff]" : "border-white/10 text-[#a6a7b8]"}`}>{kind === "market" ? "Market at trigger" : "Limit at trigger"}</button>)}</div>{triggerDraft.limitPrice !== null ? <label className="mt-3 flex h-12 items-center gap-2 rounded-xl border border-white/10 bg-[#08090f] px-3"><span className="text-xs text-[#a6a7b8]">Limit price</span><input inputMode="decimal" value={triggerDraft.limitPrice} onChange={event => { setTriggerDraft({ ...triggerDraft, limitPrice: event.target.value.replace(/[^0-9.]/g, "") }); setTriggerReview(null); }} className="min-w-0 flex-1 bg-transparent text-right text-lg outline-none select-text" /><span className="text-xs">USD</span></label> : <label className="mt-3 flex h-12 items-center gap-2 rounded-xl border border-white/10 bg-[#08090f] px-3"><span className="text-xs text-[#a6a7b8]">Slippage limit</span><input inputMode="decimal" value={triggerDraft.slippageBps ? triggerDraft.slippageBps / 100 : ""} onChange={event => { const next = Math.round(Number(event.target.value.replace(/[^0-9.]/g, "")) * 100); setTriggerDraft({ ...triggerDraft, slippageBps: next }); setTriggerReview(null); }} className="min-w-0 flex-1 bg-transparent text-right text-lg outline-none select-text" /><span className="text-xs">%</span></label>}{triggerReview && triggerSetup && <p className="mt-3 text-xs text-[#a6a7b8]">Your passkey also authorizes Perpl to execute stops while you are offline and saves encrypted trading access on this device. Network fee up to {number(triggerSetup.maxNetworkFee, 6)} MON.</p>}{triggerReview && <div className="mt-4 rounded-xl border border-[#baa5ff]/30 bg-[#baa5ff]/10 p-3 text-xs"><p>Review {triggerReview.kind === "stopLoss" ? "stop loss" : "take profit"} · {triggerReview.quantity} {triggerReview.symbol}</p><p className="mt-1 text-[#dfd4ff]">Current mark {money(triggerReview.markPrice)} → trigger {money(triggerReview.triggerPrice)}</p><p className="mt-1 text-[#a6a7b8]">{triggerReview.limitPrice ? `Limit ${money(triggerReview.limitPrice)}` : `Market · ${number(triggerReview.slippageBps / 100)}% slippage`}</p></div>}{error && <p role="alert" className="mt-3 text-xs text-[#ff8b9a]">{error}</p>}<button type="button" disabled={busy || !triggerDraft.triggerPrice || !triggerDraft.quantity || (triggerDraft.limitPrice !== null && !triggerDraft.limitPrice)} onClick={() => void (triggerReview ? submitTrigger() : prepareTrigger())} className="mt-5 h-12 w-full rounded-2xl bg-[#baa5ff] text-sm font-semibold text-[#08090f] disabled:opacity-40">{busy ? signingStage || "Preparing…" : triggerReview ? "Confirm with passkey" : "Review protection"}</button></div></div>}
    {editOrder && !review && <div role="dialog" aria-modal="true" aria-label="Edit resting order" className="fixed inset-0 z-40 flex items-end justify-center bg-black/75 px-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:items-center"><div className="w-full max-w-[500px] rounded-[28px] border border-white/15 bg-[#141620] p-5"><div className="flex items-center justify-between"><h2 className="text-[23px] font-light">Edit {editOrder.symbol} order</h2><button type="button" onClick={() => setEditOrder(null)} aria-label="Dismiss order edit"><XIcon className="h-5 w-5" /></button></div><p className="mt-2 text-xs text-[#a6a7b8]">Updates the resting contract order #{editOrder.orderId}. Size is the remaining quantity.</p><label className="mt-4 flex h-12 items-center gap-2 rounded-xl border border-white/10 bg-[#08090f] px-3"><span className="text-xs text-[#a6a7b8]">Price</span><input inputMode="decimal" value={editOrder.price} onChange={event => setEditOrder({ ...editOrder, price: event.target.value.replace(/[^0-9.]/g, "") })} className="min-w-0 flex-1 bg-transparent text-right text-lg outline-none select-text" /><span className="text-xs">USD</span></label><label className="mt-3 flex h-12 items-center gap-2 rounded-xl border border-white/10 bg-[#08090f] px-3"><span className="text-xs text-[#a6a7b8]">Remaining size</span><input inputMode="decimal" value={editOrder.size} onChange={event => setEditOrder({ ...editOrder, size: event.target.value.replace(/[^0-9.]/g, "") })} className="min-w-0 flex-1 bg-transparent text-right text-lg outline-none select-text" /><span className="text-xs">{editOrder.symbol}</span></label>{error && <p role="alert" className="mt-3 text-xs text-[#ff8b9a]">{error}</p>}<button type="button" disabled={busy || Number(editOrder.price) <= 0 || Number(editOrder.size) <= 0} onClick={() => void prepareChange()} className="mt-5 h-12 w-full rounded-2xl bg-[#baa5ff] text-sm font-semibold text-[#08090f] disabled:opacity-40">{busy ? "Preparing…" : "Review order update"}</button></div></div>}
    {closeDraft && !quote && !review && <div role="dialog" aria-modal="true" aria-label="Close position options" className="fixed inset-0 z-40 flex items-end justify-center bg-black/75 px-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:items-center"><div className="w-full max-w-[500px] rounded-[28px] border border-white/15 bg-[#141620] p-5"><div className="flex items-center justify-between"><h2 className="text-[23px] font-light">Close {closeDraft.symbol}</h2><button type="button" onClick={() => setCloseDraft(null)} aria-label="Dismiss close options"><XIcon className="h-5 w-5" /></button></div><p className="mt-2 text-xs text-[#a6a7b8]">Reduce only · current position {number(closeDraft.size, 6)} {closeDraft.symbol}</p><div className="mt-4 grid grid-cols-4 gap-2">{([25, 50, 75, 100] as const).map(percent => <button type="button" key={percent} onClick={() => { const decimals = markets[closeDraft.marketId]?.sizeDecimals ?? 6; const scale = 10 ** decimals; setCloseAmount(percent === 100 ? closeDraft.size : (Math.floor(Number(closeDraft.size) * percent / 100 * scale) / scale).toString()); }} className="rounded-xl border border-white/10 bg-white/[0.04] py-2 text-xs text-[#baa5ff]">{percent}%</button>)}</div><label className="mt-4 flex h-12 items-center gap-2 rounded-xl border border-white/10 bg-[#08090f] px-3"><span className="text-xs text-[#a6a7b8]">Close size</span><input inputMode="decimal" value={closeAmount} onChange={event => setCloseAmount(event.target.value.replace(/[^0-9.]/g, ""))} className="min-w-0 flex-1 bg-transparent text-right text-lg outline-none select-text" /><span className="text-xs">{closeDraft.symbol}</span></label><div className="mt-4 flex gap-2">{(["market", "limit"] as const).map(kind => <button type="button" key={kind} aria-pressed={closeMode === kind} onClick={() => setCloseMode(kind)} className={`flex-1 rounded-xl border py-2.5 text-xs capitalize ${closeMode === kind ? "border-[#baa5ff]/60 bg-[#baa5ff]/20 text-[#e4d8ff]" : "border-white/10 text-[#a6a7b8]"}`}>{kind} close</button>)}</div>{closeMode === "limit" ? <label className="mt-3 flex h-12 items-center gap-2 rounded-xl border border-white/10 bg-[#08090f] px-3"><span className="text-xs text-[#a6a7b8]">Limit price</span><input inputMode="decimal" value={closeLimitPrice} onChange={event => setCloseLimitPrice(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" className="min-w-0 flex-1 bg-transparent text-right text-lg outline-none select-text" /><span className="text-xs">USD</span></label> : <p className="mt-3 text-[11px] text-[#a6a7b8]">Market close uses your {number(slippage / 100)}% slippage limit. Unfilled size remains in the position.</p>}{error && <p role="alert" className="mt-3 text-xs text-[#ff8b9a]">{error}</p>}<button type="button" disabled={busy || !closeAmount || Number(closeAmount) <= 0 || Number(closeAmount) > Number(closeDraft.size) || (closeMode === "limit" && !closeLimitPrice)} onClick={() => void previewPositionClose()} className="mt-5 h-12 w-full rounded-2xl bg-[#baa5ff] text-sm font-semibold text-[#08090f] disabled:opacity-40">{busy ? "Preparing…" : "Review close"}</button></div></div>}
    {quote && !review && <div role="dialog" aria-modal="true" aria-label="Review trade" className="fixed inset-0 z-40 flex items-end justify-center bg-black/75 px-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:items-center"><div className="max-h-[calc(100dvh-24px)] w-full max-w-[500px] overflow-y-auto scrollbar-hidden rounded-[28px] border border-white/15 bg-[#141620] p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-[25px] font-light">{closeInput ? "Review close" : "Review your trade"}</h2><button type="button" onClick={closeReview} aria-label="Close review"><XIcon className="h-5 w-5" /></button></div><p className="mt-3 text-sm text-[#baa5ff]">{closeInput ? "CLOSE" : quote.side.toUpperCase()} {quote.symbol} · {quote.orderType.toUpperCase()}{closeInput ? "" : ` · ${number(quote.leverageHundredths / 100)}×`}</p><p className="mt-5 text-[36px] font-light">{money(quote.sizeUsd)}</p><dl className="mt-4 space-y-3 text-xs">{[["Quantity", `${quote.quantity} ${quote.symbol}`], ["Reference price", money(quote.referencePrice)], [quote.orderType === "market" ? "Worst execution price" : "Limit price", money(quote.worstPrice)], ...(closeInput ? [] : [["Estimated margin", `${number(quote.estimatedMargin)} AUSD`]]), ["Estimated fee", `${number(quote.estimatedFee)} AUSD`], ["Available", `${number(quote.availableBalance)} AUSD`]].map(([label, value]) => <div key={label} className="flex justify-between gap-4"><dt className="text-[#a6a7b8]">{label}</dt><dd className="text-right">{value}</dd></div>)}</dl>{quote.orderType === "market" && <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs"><p className="text-[#baa5ff]">Current order-book estimate</p>{quote.indicativeFillQuantity != null ? <p className="mt-1">Up to {number(quote.indicativeFillQuantity, 6)} {quote.symbol} near {quote.indicativeAveragePrice ? money(quote.indicativeAveragePrice) : "the selected price bound"}</p> : <p className="mt-1 text-[#a6a7b8]">Live order-book depth is unavailable.</p>}<p className="mt-1 text-[10px] text-[#a6a7b8]">Liquidity can change before confirmation; actual fill may be smaller or zero.</p></div>}<p className="mt-5 text-[11px] leading-relaxed text-[#a6a7b8]">{quote.orderType === "market" ? "Market orders use an immediate or cancel price bound. Unfilled size is canceled." : quote.timeInForce === "gtc" ? "This limit order can rest on the book until filled or canceled." : quote.timeInForce === "ioc" ? "Unfilled size is canceled immediately." : quote.timeInForce === "fok" ? "The entire size must fill immediately or the order is canceled." : "Post only adds this order to the book and rejects a crossing price."} Leverage can liquidate your position.</p><p className="mt-2 text-[11px] leading-relaxed text-[#a6a7b8]">This quantity and price limit stay fixed through signing. Refresh the quote to choose new terms.</p>{error && <p role="alert" className="mt-3 text-xs text-[#ff8b9a]">{error}</p>}<button type="button" disabled={busy} onClick={() => void prepareOrder()} className="mt-5 h-12 w-full rounded-2xl bg-[#baa5ff] text-sm font-semibold text-[#08090f] disabled:opacity-50">{busy ? "Preparing…" : "Prepare onchain order"}</button><button type="button" disabled={busy} onClick={() => void refreshQuote()} className="mt-2 h-10 w-full rounded-xl border border-white/10 text-xs text-[#baa5ff] disabled:opacity-50">Refresh quote</button></div></div>}
    {fundingOpen && !review && <div role="dialog" aria-modal="true" aria-label="Manage Perpl funds" className="fixed inset-0 z-40 flex items-end justify-center bg-black/75 px-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:items-center"><div className="w-full max-w-[500px] rounded-[28px] border border-white/15 bg-[#141620] p-5"><div className="flex justify-between"><h2 className="text-[25px] font-light">{fundingAction === "withdraw" ? "Withdraw AUSD" : account?.exists ? "Deposit AUSD" : "Create Perpl account"}</h2><button type="button" onClick={() => setFundingOpen(false)} aria-label="Close"><XIcon className="h-5 w-5" /></button></div><p className="mt-2 text-xs text-[#a6a7b8]">{fundingAction === "withdraw" ? `Available: ${number(account?.availableBalance)} AUSD` : `Wallet: ${number(account?.walletAusd)} AUSD · allowance: ${number(account?.allowance)} AUSD`}</p>{!account?.exists && fundingAction === "deposit" && <p className="mt-3 text-xs text-[#baa5ff]">Initial deposit minimum: {number(account?.minimumOpen)} AUSD</p>}<label className="mt-5 flex h-12 items-center gap-2 rounded-xl border border-white/10 bg-[#08090f] px-3"><span className="text-xs text-[#a6a7b8]">Amount</span><input inputMode="decimal" value={fundingAmount} onChange={event => setFundingAmount(event.target.value)} placeholder="0" className="min-w-0 flex-1 bg-transparent text-right text-lg outline-none select-text" /><span className="text-xs">AUSD</span></label>{error && <p role="alert" className="mt-3 text-xs text-[#ff8b9a]">{error}</p>}<button type="button" disabled={busy || !account || !fundingAmount} onClick={() => void prepareFunding()} className="mt-5 h-12 w-full rounded-2xl bg-[#baa5ff] text-sm font-semibold text-[#08090f] disabled:opacity-40">{busy ? "Preparing…" : fundingAction === "withdraw" ? "Review withdrawal" : account && Number(account.allowance) < Number(fundingAmount) ? "Review AUSD approval" : account?.exists ? "Review deposit" : "Review account creation"}</button><p className="mt-3 text-[11px] text-[#a6a7b8]">Each approval and deposit is a separate onchain transaction signed with your passkey.</p></div></div>}
    {review && <div role="dialog" aria-modal="true" aria-label="Confirm transaction" className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 px-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:items-center"><div className="max-h-[calc(100dvh-24px)] w-full max-w-[500px] overflow-y-auto scrollbar-hidden rounded-[28px] border border-white/15 bg-[#141620] p-5"><div className="flex items-center justify-between"><h2 className="text-[25px] font-light">Confirm with passkey</h2><button type="button" disabled={busy} onClick={closeReview} aria-label="Close"><XIcon className="h-5 w-5" /></button></div><p className="mt-4 text-sm capitalize">{review.action === "order" ? `${review.quote?.side} ${review.quote?.symbol} order` : review.action.replace(/([A-Z])/g, " $1")}</p>{review.amount && <p className="mt-2 text-xs text-[#dfd4ff]">{review.amount}</p>}{review.action === "forwarding" && <p className="mt-2 text-xs leading-relaxed text-[#a6a7b8]">Allows Perpl to forward protected orders from your trade-scoped key. This permission stays active until revoked onchain.</p>}{previousWorstPrice && review.quote?.orderType === "market" && <div role="status" className="mt-3 rounded-xl border border-[#baa5ff]/30 bg-[#baa5ff]/10 p-3 text-xs text-[#d8ccff]"><p className="font-medium">Market price updated</p><p className="mt-1 leading-relaxed">Review the current price and worst execution price below. Sign only if you accept them.</p><p className="mt-1 text-[11px]">Previous worst {money(previousWorstPrice)} · Slippage cap {number(review.quote.slippageBps / 100)}%</p></div>}{review.quote && <div className="mt-3 rounded-xl border border-white/10 bg-[#08090f] p-3 text-xs"><p>{review.quote.quantity} {review.quote.symbol} · {review.quote.orderType === "limit" ? "Limit" : "Worst execution"} {money(review.quote.worstPrice)}</p><p className="mt-1 text-[#a6a7b8]">Estimated {money(review.quote.sizeUsd)} · fee {number(review.quote.estimatedFee)} AUSD</p>{review.action === "order" && <p className="mt-1 text-[#a6a7b8]">Estimated margin {number(review.quote.estimatedMargin)} AUSD</p>}{(review.action === "order" || review.action === "close") && <p className="mt-1 text-[#a6a7b8]">Perpl may use additional available AUSD for negative PnL, up to 10% of this order's value.</p>}{review.quote.orderType === "market" && <p className="mt-1 text-[#baa5ff]">Slippage limit {number(review.quote.slippageBps / 100)}%</p>}</div>}<p className="mt-2 text-xs text-[#a6a7b8]">Monad testnet · Network fee cap {number(Number(review.maxNetworkFee) * (review.quote?.orderType === "market" ? 1.5 : 1), 6)} MON</p><p className="mt-1 break-all font-mono text-[10px] text-[#a6a7b8]">Contract {review.to}</p>{error && <p role="alert" className="mt-4 break-words text-xs text-[#ff8b9a]">{error}</p>}{error && (orderInput || closeInput) && <button type="button" disabled={busy} onClick={() => void retryReview()} className="mt-3 w-full rounded-xl border border-white/15 py-3 text-xs text-[#baa5ff] disabled:opacity-50">Refresh and review order</button>}<button type="button" disabled={busy} onClick={() => void send()} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#baa5ff] text-sm font-semibold text-[#08090f] disabled:opacity-50">{busy ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <FingerprintIcon className="h-4 w-4" />}{busy ? signingStage || "Preparing…" : previousWorstPrice && review.quote?.orderType === "market" ? "Accept price and sign" : review.quote?.orderType === "market" ? "Sign market order" : "Sign and send"}</button></div></div>}
  </div>;
}
