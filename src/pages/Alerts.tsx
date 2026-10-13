import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router";
import { AlertsScreen, type AlertPreferences, type PriceAlertDraft } from "../design/pages/AlertsScreen";
import { useTradingSession } from "../trading/TradingSession";
import { useSessionAddress } from "../utils/authSession";
import { notify } from "../notifications/store";
import { errorText } from "../utils/errorText";
import { AppTabs } from "../components/AppTabs";
import { requestAlertSync } from "../notifications/AutomaticAlerts";
type Alert={id:string;marketId:number;symbol:string;watch:string;direction:string;targetPrice:string;triggered:boolean;remote:boolean};
export default function Alerts(){
 const navigate=useNavigate();const address=useSessionAddress();const {prices}=useTradingSession();const [alerts,setAlerts]=useState<Alert[]>([]);const [busy,setBusy]=useState(false);const [preferences,setPreferences]=useState<AlertPreferences>({orderFills:true,slTpUpdates:true,liquidationThreshold:"off"});
 useEffect(()=>{void invoke<AlertPreferences>("get_alert_preferences",{address}).then(setPreferences).catch(()=>{});void invoke<Alert[]>("list_price_alerts",{address}).then(setAlerts).catch(cause=>notify({kind:"error",message:errorText(cause)}));},[address]);
 useEffect(()=>{if(!address)return;let disposed=false;let stop:(()=>void)|undefined;void listen("exora-alerts-synced",()=>{void invoke<Alert[]>("list_price_alerts",{address}).then(items=>{if(!disposed)setAlerts(items);}).catch(()=>{});}).then(unlisten=>{if(disposed)unlisten();else stop=unlisten;}).catch(()=>{});return()=>{disposed=true;stop?.();};},[address]);
 const create=async(draft:PriceAlertDraft)=>{if(!address||busy)return;setBusy(true);try{setAlerts(await invoke<Alert[]>("create_price_alert",{address,input:{marketId:Number(draft.market),watch:draft.watch,direction:draft.direction,targetPrice:draft.targetPrice}}));requestAlertSync();notify({kind:"success",message:"Price alert saved."});}catch(cause){notify({kind:"error",message:errorText(cause)});}finally{setBusy(false);}};
 return <main className="exora-design mx-auto min-h-[100dvh] max-w-[540px] bg-canvas pb-24 text-fg" style={{paddingTop:"env(safe-area-inset-top)"}}>
  <AlertsScreen initialAlert={{market:"",watch:"mark",direction:"above",targetPrice:""}}
   marketOptions={Object.values(prices).map(p=>({value:String(p.marketId),label:p.symbol}))}
   watchOptions={[{value:"mark",label:"Mark price"},{value:"last",label:"Last trade"}]} thresholdOptions={[{value:"off",label:"Off"},{value:"2",label:"2%"},{value:"5",label:"5%"},{value:"10",label:"10%"}]}
   preferences={preferences} onPreferencesChange={next=>void invoke("save_alert_preferences",{address,preferences:next}).then(()=>{setPreferences(next);requestAlertSync();}).catch(cause=>notify({kind:"error",message:errorText(cause)}))}
   onCreateAlert={draft=>void create(draft)} onOpenSettings={()=>navigate('/preferences')} />
  <div className="px-[18px]">
  <h2 className="mt-5 text-sm">Saved alerts</h2>{alerts.length===0&&<p className="py-4 text-xs text-muted">No saved price alerts.</p>}
  {alerts.map(a=><div key={a.id} className="flex items-center justify-between border-b border-line py-3 text-xs"><span>{a.symbol} {a.watch} {a.direction} {a.targetPrice}<span className="block text-muted">{a.triggered?'Triggered':a.remote?'Armed · monitored while away':'Armed while app is active'}</span></span><button className="min-h-11 text-short" onClick={()=>void invoke<Alert[]>("remove_price_alert",{address,id:a.id}).then(items=>{setAlerts(items);requestAlertSync();}).catch(cause=>notify({kind:"error",message:errorText(cause)}))}>Remove</button></div>)}
  </div><AppTabs active="home" />
 </main>;
}
