import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AdjustMarginScreen } from "../design/pages/AdjustMarginScreen";
import type { Account, Position } from "./service";
import { errorText } from "../utils/errorText";
export type MarginDraft={marketId:number;symbol:string;mode:'add'|'remove';amount:string};
type Preview={margin:string;health:Position['health']};
export function AdjustMargin({draft,account,busy,error,onChange,onClose,onSubmit}:{draft:MarginDraft;account:Account|null;busy:boolean;error:string;onChange:(draft:MarginDraft)=>void;onClose:()=>void;onSubmit:()=>void}){
 const position=account?.positions.find(p=>p.marketId===draft.marketId);const [preview,setPreview]=useState<Preview|null>(null);const [previewError,setPreviewError]=useState("");
 useEffect(()=>{let active=true;setPreview(null);setPreviewError("");if(!position||!draft.amount)return;
  const timer=window.setTimeout(()=>{void invoke<Preview>("preview_margin_change",{input:{marketId:draft.marketId,side:position.side,entry:position.entryPrice,mark:position.markPrice,size:position.size,deposit:position.deposit,funding:position.premiumPnl,mode:draft.mode,amount:draft.amount}}).then(value=>{if(active)setPreview(value);}).catch(cause=>{if(active)setPreviewError(errorText(cause));});},250);
  return()=>{active=false;window.clearTimeout(timer);};
 },[draft.marketId,draft.mode,draft.amount,position?.markPrice,position?.deposit,position?.premiumPnl]);
 const money=(v:string|null|undefined)=>v==null?null:`$${Number(v).toLocaleString(undefined,{maximumFractionDigits:4})}`;
 const suffix=(v:string|null|undefined,s:string)=>v==null?null:`${Number(v).toLocaleString(undefined,{maximumFractionDigits:2})}${s}`;
 return <div role="dialog" aria-modal="true" aria-label="Adjust position margin" className="fixed inset-0 z-40 flex items-end justify-center bg-black/75 p-3"><div className="max-h-[92dvh] w-full max-w-[500px] overflow-auto border border-line bg-canvas">
 <fieldset disabled={busy} className="min-w-0"><AdjustMarginScreen collateralSymbol="AUSD" feeSymbol="MON" positions={(account?.positions??[]).map(p=>({value:String(p.marketId),label:`${p.symbol} · ${p.side}`}))}
  positionId={String(draft.marketId)} onPositionChange={id=>{const p=account?.positions.find(p=>p.marketId===Number(id));if(p)onChange({...draft,marketId:p.marketId,symbol:p.symbol,amount:""});}}
  mode={draft.mode} onModeChange={mode=>onChange({...draft,mode,amount:""})} accountConnected={!!account} amount={draft.amount} onAmountChange={amount=>onChange({...draft,amount})}
  available={draft.mode==='add'?account?.availableBalance:null} disabled={busy||!preview} quickAmountsEnabled={draft.mode==='add'}
  onQuickAmount={fraction=>void invoke<string>("percentage_amount",{amount:account?.availableBalance??"0",percent:Math.round(fraction*100)}).then(amount=>onChange({...draft,amount})).catch(cause=>setPreviewError(errorText(cause)))}
  preview={{positionMargin:{before:money(position?.deposit),after:money(preview?.margin)},leverage:{before:suffix(position?.health.effectiveLeverage,'×'),after:suffix(preview?.health.effectiveLeverage,'×')},liquidationPrice:{before:money(position?.health.liquidationPrice),after:money(preview?.health.liquidationPrice)},liquidationDistance:{before:suffix(position?.health.distancePercent,'%'),after:suffix(preview?.health.distancePercent,'%')}}}
  onBack={()=>{if(!busy)onClose();}} onSubmit={onSubmit}/></fieldset>
 <div className="px-[18px] pb-5">{(error||previewError)&&<p role="alert" className="mb-3 text-xs text-short">{error||previewError}</p>}<p className="text-xs text-muted">{draft.mode==='remove'?'This previews your requested change. Perpl must approve and execute it within 120 seconds. Request confirmation is not removal confirmation.':'Estimates use the last account snapshot. Network fee and fresh contract checks follow in the passkey review.'}</p></div>
 </div></div>;
}
