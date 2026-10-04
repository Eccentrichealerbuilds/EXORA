import { useEffect, useState } from "react";
import { startFeed } from "../websocket/feed";
import type { ConnectionState } from "../types";
import type { MarketEvent, MarketInfo } from "./types";
import { watchAccount, type Account } from "./service";
import { useChartData } from "./useChartData";
import { errorText } from "../utils/errorText";

const emptyStatus: ConnectionState = { state: "connecting", message: "Connecting to Perpl" };

export function useTradingData(address: string | null, selectedMarket: number, resolution: number) {
  const [markets, setMarkets] = useState<Record<number, MarketInfo>>({});
  const chart = useChartData(selectedMarket, resolution);
  const [status, setStatus] = useState<ConnectionState>(emptyStatus);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountError, setAccountError] = useState("");

  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    setStatus(emptyStatus);
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
      } else if (event.type === "candles" && event.marketId === selectedMarket && event.resolution === resolution) {
        chart.acceptCandles(event.candles);
      }
    };
    void startFeed(() => {}, value => { if (active) { setStatus(value); if (value.state === "connected") void chart.loadHistory(false); } }, onMarket, selectedMarket, resolution)
      .then(cleanup => { if (active) stop = cleanup; else cleanup(); })
      .catch(error => { if (active) setStatus({ state: "error", message: errorText(error) }); });
    return () => { active = false; stop?.(); };
  }, [selectedMarket, resolution]);

  useEffect(() => {
    if (!address) { setAccount(null); return; }
    let active = true;
    let stop: (() => void) | undefined;
    void watchAccount(address,
      next => { if (active) { setAccount(next); setAccountError(""); } },
      event => { if (active && event.state === "error") setAccountError(errorText(event.message ?? "Account sync failed")); })
      .then(cleanup => { if (active) stop = cleanup; else cleanup(); })
      .catch(error => { if (active) setAccountError(errorText(error)); });
    return () => { active = false; stop?.(); };
  }, [address]);

  return { markets, ...chart, status, account, accountError, setAccount };
}
