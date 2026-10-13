import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DraftLevels } from "./TradePlanner";
import { errorText } from "../utils/errorText";

type Outcome = { loss: string; gain: string | null; rewardRisk: string | null };

/** Recompute the draft after chart dragging without changing any executable order. */
export function DraftPlanSummary({ marketId, levels, sizeUsd, onClear }: {
  marketId: number; levels: DraftLevels; sizeUsd: string; onClear: () => void;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setOutcome(null); setError("");
    const timer = window.setTimeout(() => {
      void invoke<Outcome>("preview_trade_plan", { input: {
        marketId, ...levels, target: levels.target || null, sizing: "usd", amount: sizeUsd.replace(/,/g, ""),
      } }).then(result => { if (active) setOutcome(result); })
        .catch(cause => { if (active) setError(errorText(cause)); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [marketId, levels, sizeUsd]);
  const dollars = (value: string) => `$${Number(value).toLocaleString(undefined, { maximumFractionDigits:2 })}`;
  return <section aria-label="Draft outcome" className="mt-2 border border-line p-3 text-xs">
    <div className="flex items-center justify-between gap-2"><span className="capitalize text-accent">{levels.side} draft · not armed</span><button type="button" onClick={onClear} className="min-h-9 text-muted">Clear levels</button></div>
    {error ? <p role="status" className="text-short">{error}</p> : <p role="status" className="text-fg">{outcome ? `At stop −${dollars(outcome.loss)}${outcome.gain ? ` · At target +${dollars(outcome.gain)}` : ""}` : "Updating draft…"}</p>}
    <p className="mt-1 text-micro text-muted">Drag the chart labels to plan. Estimates exclude fees, funding and slippage. Your order uses the side and price in its review.</p>
  </section>;
}
