import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { errorText } from "../utils/errorText";
type Point = { time: number; value: string };
type PerformanceData = { equity: Point[]; pnl: Point[]; updatedAt: number; cached: boolean };
export function Performance({ address, period, connected }: {address: string; period: string; connected: boolean}) {
 const [data, setData] = useState<PerformanceData | null>(null);
 const [error, setError] = useState("");
 const [attempt, retry] = useState(0);
 useEffect(() => {
  let active = true; setData(null); setError("");
  if (connected) void invoke<PerformanceData>("get_perpl_performance", {address, period: ({"1D":"day","1W":"week","1M":"month",All:"all"} as Record<string,string>)[period] ?? "week"})
   .then(result => { if (active) setData(result); }).catch(cause => { if (active) setError(errorText(cause)); });
  return () => { active = false; };
 }, [address, period, connected, attempt]);
 if (!connected) return <p role="status" className="py-5 text-center text-xs text-muted">Performance appears when your account data is ready.</p>;
 if (error) return <button onClick={() => retry(attempt+1)} className="w-full min-h-16 border-y border-line text-xs text-muted">Performance unavailable · Tap to retry</button>;
 if (!data) return <p role="status" className="py-5 text-center text-xs text-muted">Loading performance…</p>;
 const points = data.equity.filter(p => Number.isFinite(Number(p.value)));
 const values = points.map(p => Number(p.value));
 const min = Math.min(...values), max = Math.max(...values), span = max-min || 1;
 const d = points.map((p,i) => `${i ? 'L' : 'M'}${i*300/Math.max(1,points.length-1)},${65-(Number(p.value)-min)*60/span}`).join(' ');
 const format = (p: Point | undefined) => p ? Number(p.value).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2}) : '—';
 return <div>
  <dl className="flex justify-between text-xs"><div><dt className="text-muted">Reported PnL</dt><dd>{format(data.pnl[data.pnl.length-1])}</dd></div><div className="text-right"><dt className="text-muted">Equity</dt><dd>{format(points[points.length-1])}</dd></div></dl>
  {points.length > 1 ? <svg role="img" aria-label={`Account equity, ${period}`} viewBox="0 0 300 70" className="my-3 h-24 w-full" preserveAspectRatio="none"><path d={d} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg> : <p className="py-5 text-xs text-muted">No performance history for this period.</p>}
  <p className="text-micro text-muted">{data.cached ? "Saved snapshot · " : "Updated "}{data.updatedAt ? new Date(data.updatedAt).toLocaleString() : "—"}</p>
 </div>;
}
