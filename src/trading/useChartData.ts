import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import type { Candle } from "./types";

type History = { candles: Candle[]; from: number; to: number; cached: boolean };
const merge = (current: Candle[], incoming: Candle[]) => [...new Map([...current, ...incoming].map(c => [c.time, c])).values()].sort((a,b) => a.time-b.time).slice(-12000);

export function useChartData(marketId: number, resolution: number) {
  const key = `${marketId}:${resolution}`;
  const activeKey = useRef(key); activeKey.current = key;
  const [data, setData] = useState<{key: string; candles: Candle[]}>({key, candles: []});
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const before = useRef<number | null>(null);
  const retryOlder = useRef(false);
  const count = useRef(0); count.current = data.key === key ? data.candles.length : 0;
  const flight = useRef<{key: string; token: object} | null>(null);
  const live = useCallback((incoming: Candle[]) => {
    if (activeKey.current !== key) return;
    setData(current => ({key, candles: merge(current.key === key ? current.candles : [], incoming)}));
  }, [key]);
  const request = useCallback(async (older = retryOlder.current) => {
    if (flight.current?.key === key || activeKey.current !== key) return;
    const end = older ? before.current : null;
    if (older && (end === null || end <= 0 || count.current >= 12000)) return;
    const token = {}; flight.current = {key, token};
    setLoading(true); setHistoryError("");
    const channel = new Channel<History>();
    channel.onmessage = result => {
      if (activeKey.current !== key || flight.current?.token !== token) return;
      // Cached data only fills missing bars; a delayed cache reply cannot roll back live prices.
      setData(current => ({ key, candles: result.cached
        ? merge(result.candles, current.key === key ? current.candles : [])
        : merge(current.key === key ? current.candles : [], result.candles) }));
      if (!result.cached) before.current = Math.min(before.current ?? Infinity, result.from - 1);
    };
    try { await invoke("get_chart_history", {marketId, resolution, before: end, onCandles: channel}); retryOlder.current = false; }
    catch { if (activeKey.current === key) { retryOlder.current = older; setHistoryError("Chart history couldn't load. Tap retry to reconnect."); } }
    finally { if (flight.current?.token === token) { flight.current = null; setLoading(false); } }
  }, [key, marketId, resolution]);
  useEffect(() => { activeKey.current = key; before.current = null; retryOlder.current = false; flight.current = null; setHistoryError(""); setLoading(false);
    return () => { activeKey.current = ""; flight.current = null; };
  }, [key]);
  return { candles: data.key === key ? data.candles : [], acceptCandles: live,
    canLoadOlder: count.current < 12000 && before.current !== 0, loadHistory: request, historyLoading: loading, historyError };
}
