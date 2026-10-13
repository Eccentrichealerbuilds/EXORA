import { usePreferences } from "../preferences/service";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Activity } from "./service";
import { notify } from "../notifications/store";
import { errorText } from "../utils/errorText";
export function Journal({ address, records }: {address: string; records: Activity[]}) {
 const preferences = usePreferences();
 const [selected, setSelected] = useState<Activity | null>(null);
 const [note,setNote] = useState(""); const [loading,setLoading] = useState(false);
 const [saving,setSaving] = useState(false);
 useEffect(() => {
  let active=true; setNote(""); setLoading(!!selected);
  if (selected) void invoke<string>("get_journal_note",{address,id:selected.id}).then(value=>{if(active)setNote(value);})
   .catch(cause=>notify({kind:"error",message:errorText(cause)})).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[address,selected?.id]);
 const entries=records.filter(item=>item.positionReason != null);
 const usd=(v:string|null)=>v===null?"—":Number(v).toLocaleString(undefined,{style:"currency",currency:"USD"});
 const label=(reason:number|null)=>({13:"Closed",14:"Reduced",15:"Deleveraged",17:"Increased",18:"Inverted",19:"Liquidated",21:"Opened",22:"Unwound"} as Record<number,string>)[reason??0]??"Position update";
 const save=async()=>{if(!selected||loading||saving)return;setSaving(true);try{await invoke("save_journal_note",{address,id:selected.id,note});notify({kind:"success",message:"Journal note saved on this device."});}catch(e){notify({kind:"error",message:errorText(e)});}finally{setSaving(false);}};
 const share=async()=>{
  if(!selected)return;
  const text=`EXORA${preferences.hideWalletInShares ? "" : ` · ${address}`} · ${selected.symbol??"Perpetual"} · ${label(selected.positionReason)}\nRealized PnL ${usd(selected.realizedPnl)} · Fees ${usd(selected.fees)} · Funding ${usd(selected.funding)}\n${new Date(selected.timestampMs).toLocaleString()}`;
  try{if(navigator.share)await navigator.share({title:"EXORA trading journal",text});else{await navigator.clipboard.writeText(text);notify({message:"Trade summary copied.",kind:"success"});}}catch{notify({message:"Sharing was canceled or unavailable.",kind:"info"});}
 };
 return <section>
  <p className="mb-3 text-micro text-muted">Loaded position events · Fees include entry and exit portions on reductions. Liquidation PnL is not your final balance change.</p>
  {!entries.length&&<p className="py-8 text-center text-sm text-muted">No position events in the loaded history.</p>}
  {entries.map(item=><button key={item.id} onClick={()=>setSelected(item)} className="flex min-h-16 w-full items-center justify-between border-b border-line text-left"><span><span className="block text-sm">{item.symbol} · {label(item.positionReason)}</span><span className="text-micro text-muted">{new Date(item.timestampMs).toLocaleString()}</span></span><span className="text-xs">{usd(item.realizedPnl)}</span></button>)}
  {selected&&<div role="dialog" aria-modal="true" aria-label="Journal event" className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-3"><div className="w-full max-w-[500px] border border-line bg-canvas p-5">
   <div className="flex items-center justify-between"><h2 className="font-semibold">{selected.symbol} · {label(selected.positionReason)}</h2><button disabled={saving} onClick={()=>setSelected(null)} className="min-h-11 px-2 text-xs text-accent">Close</button></div>
   <dl className="my-4 space-y-2 text-xs">{[["Realized PnL",selected.realizedPnl],["Event fees",selected.fees],["Funding PnL",selected.funding]].map(([k,v])=><div key={k} className="flex justify-between"><dt className="text-muted">{k}</dt><dd>{usd(v)}</dd></div>)}</dl>
   <label className="text-xs text-muted">Personal notes<textarea disabled={loading||saving} maxLength={8000} value={note} onChange={e=>setNote(e.target.value)} className="mt-2 min-h-28 w-full resize-y rounded border border-line bg-surface p-3 text-fg" /></label>
   <div className="mt-3 flex gap-2"><button disabled={loading||saving} onClick={()=>void save()} className="min-h-11 flex-1 bg-accent text-sm text-ink disabled:opacity-40">{saving?"Saving…":"Save note"}</button><button onClick={()=>void share()} className="min-h-11 flex-1 border border-line text-sm">Share summary</button></div>
  </div></div>}
 </section>;
}
