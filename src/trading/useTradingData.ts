import { useEffect, useRef, useState } from "react";
import { startFeed } from "../websocket/feed";
import type { ConnectionState, PriceUpdate } from "../types";
import type { MarketEvent, MarketInfo, OrderBookView } from "./types";
import { watchAccount, type Account } from "./service";
import { useChartData } from "./useChartData";
import { errorText } from "../utils/errorText";

const emptyStatus: ConnectionState = { state: "connecting", message: "Connecting to Perpl" };

export function useTradingData(address: string | null, selectedMarket: number, resolution: number, enabled = true) {
  const [prices, setPrices] = useState<Record<number, PriceUpdate>>({});
  const bookReceivedAt = useRef(0);
  const [bookFresh, setBookFresh] = useState(false);
  useEffect(() => { const timer = window.setInterval(() => setBookFresh(bookReceivedAt.current > 0 && Date.now() - bookReceivedAt.current < 30_000), 1000); return () => window.clearInterval(timer); }, []);
  const [book, setBook] = useState<OrderBookView | null>(null);
  const [markets, setMarkets] = useState<Record<number, MarketInfo>>({});
  const chart = useChartData(selectedMarket, resolution);
  const [status, setStatus] = useState<ConnectionState>(emptyStatus);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountError, setAccountError] = useState("");

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let stop: (() => void) | undefined;
    setStatus(emptyStatus);
    setBook(null); bookReceivedAt.current = 0; setBookFresh(false);
    const onMarket = (event: MarketEvent) => {
      if (!active) return;
      if (event.type === "context") {
        setMarkets(Object.fromEntries(event.markets.map(market => [market.id, market])));
      } else if (event.type === "config") {
        setMarkets(current => ({ ...current, [event.market.id]: event.market }));
      } else if (event.type === "state" || event.type === "funding") {
        setMarkets(current => {
          const previous = current[event.marketId];
          if (!previous) return current;
          return { ...current, [event.marketId]: event.type === "state"
            ? { ...previous, price: event.price, markPrice: event.markPrice,
                oraclePrice: event.oraclePrice, previousPrice: event.previousPrice,
                bid: event.bid, ask: event.ask, volumeUsd: event.volumeUsd,
                openInterest: event.openInterest, updatedAtMs: Date.now() }
            : { ...previous, fundingRate: event.rate } };
        });
      } else if (event.type === "book" && event.marketId === selectedMarket) {
        setBook(event); bookReceivedAt.current = Date.now(); setBookFresh(true);
      } else if (event.type === "candles" && event.marketId === selectedMarket && event.resolution === resolution) {
        chart.acceptCandles(event.candles);
      }
    };
    void startFeed(price => { if (active) setPrices(current => ({...current, [price.marketId]: price})); }, value => { if (active) { setStatus(value); if (value.state === "connected") void chart.loadHistory(false); } }, onMarket, selectedMarket, resolution)
      .then(cleanup => { if (active) stop = cleanup; else cleanup(); })
      .catch(error => { if (active) setStatus({ state: "error", message: errorText(error) }); });
    return () => { active = false; stop?.(); };
  }, [selectedMarket, resolution, enabled]);

  useEffect(() => {
    if (!address || !enabled) { setAccount(null); return; }
    let active = true;
    let stop: (() => void) | undefined;
    void watchAccount(address,
      next => { if (active) { setAccount(next); setAccountError(""); } },
      event => { if (active && event.state === "error") setAccountError(errorText(event.message ?? "Account sync failed")); })
      .then(cleanup => { if (active) stop = cleanup; else cleanup(); })
      .catch(error => { if (active) setAccountError(errorText(error)); });
    return () => { active = false; stop?.(); };
  }, [address, enabled]);

  return { prices, markets, book, bookFresh, ...chart, status, account, accountError, setAccount };
}
