import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { XIcon } from "lucide-react";
import { TradePlanScreen } from "../design/pages/TradePlanScreen";
import { TextField } from "../design/components/ui/TextField";
import { SelectField } from "../design/components/ui/SelectField";
import { errorText } from "../utils/errorText";
export type DraftLevels={entry:string;stop:string;target:string;side:"long"|"short"};
type Plan={quantity:string;sizeUsd:string;loss:string;gain:string|null;rewardRisk:string|null};
export function TradePlanner({marketId,symbol,entry,amount,leverage,onClose,onApply}:{marketId:number;symbol:string;entry:string;amount:string;leverage:number;onClose:()=>void;onApply:(plan:Plan,levels:DraftLevels)=>void}){
 const [levels,setLevels]=useState<DraftLevels>({entry,stop:"",target:"",side:"long"});const [sizing,setSizing]=useState<'usd'|'risk'>('usd');const [value,setValue]=useState(amount);const [plan,setPlan]=useState<Plan|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 const preview=async()=>{setPlan(null);setBusy(true);setError("");try{setPlan(await invoke<Plan>("preview_trade_plan",{input:{marketId,...levels,target:levels.target||null,sizing,amount:value}}));}catch(e){setError(errorText(e));}finally{setBusy(false);}};
 return <div role="dialog" aria-modal="true" aria-label="Trade planner" className="fixed inset-0 z-40 flex items-end justify-center bg-black/75 p-3"><div className="max-h-[92dvh] w-full max-w-[500px] overflow-auto border border-line bg-canvas">
  <div className="flex items-center justify-between px-[18px] py-2"><span className="text-sm">Draft only · no order submitted</span><button aria-label="Close planner" onClick={onClose} className="grid h-11 w-11 place-items-center"><XIcon className="h-5 w-5"/></button></div>
  <fieldset disabled={busy} className="min-w-0 space-y-2 px-[18px] pb-3"><div className="grid grid-cols-2 gap-2"><SelectField label="Side" value={levels.side} options={[{value:'long',label:'Long'},{value:'short',label:'Short'}]} onChange={side=>{setLevels({...levels,side});setPlan(null);}}/><SelectField label="Sizing" value={sizing} options={[{value:'usd',label:'USD notional'},{value:'risk',label:'Risk at stop'}]} onChange={v=>{setSizing(v);setPlan(null);}}/></div>
  <TextField label={sizing==='risk'?'Planned risk before costs':'Size'} suffix="USD" value={value} onChange={v=>{setValue(v);setPlan(null);}}/>
  {(['entry','stop','target'] as const).map(key=><TextField key={key} label={key==='target'?'Target (optional)':key==='stop'?'Stop':'Entry assumption'} suffix="USD" value={levels[key]} onChange={v=>{setLevels({...levels,[key]:v});setPlan(null);}}/>)}
  {error&&<p role="alert" className="text-xs text-short">{error}</p>}
  {!plan&&<button disabled={busy} onClick={()=>void preview()} className="h-11 w-full rounded bg-accent text-sm text-ink">{busy?'Calculating…':'Calculate plan'}</button>}</fieldset>
  {plan&&<><TradePlanScreen summary={`${symbol} / USD · ${levels.side} · ${leverage}×`} levels={levels} outcome={{atStop:`−$${plan.loss}`,atTarget:plan.gain?`+$${plan.gain}`:'—',lossAmount:Number(plan.loss),gainAmount:Number(plan.gain??0)}} calculations={[{label:'Quantity',value:`${plan.quantity} ${symbol}`},{label:'USD notional',value:`$${plan.sizeUsd}`},{label:'Reward / risk',value:plan.rewardRisk?`${plan.rewardRisk}:1`:'—'}]} quoteStatus="Draft" execution={[{label:'Execution terms',value:'Refreshed in trade review'}]} protection={[{label:'Stop / target',status:'Not armed'}]} onRefreshReview={()=>void preview()} />
  <div className="px-[18px] pb-5"><button onClick={()=>onApply(plan,levels)} className="h-12 w-full rounded bg-accent text-sm font-semibold text-ink">Use size & chart levels</button><p className="mt-2 text-xs text-muted">Risk at stop is an estimate before fees, funding and slippage. Set actual SL/TP protection for the filled position in Portfolio.</p></div></>}
 </div></div>;
}
