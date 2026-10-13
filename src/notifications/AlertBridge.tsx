import { useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSessionAddress } from "../utils/authSession";
import { notify } from "./store";
export function AlertBridge(){
 const address=useSessionAddress();
 useEffect(()=>{if(!isTauri())return;
  const update=()=>{void invoke("set_alert_visibility",{visible:!document.hidden}).catch(()=>{});};
  update();document.addEventListener("visibilitychange",update);
  return()=>document.removeEventListener("visibilitychange",update);
 },[]);
 useEffect(()=>{if(isTauri())void invoke("activate_alerts",{address}).catch(()=>{});},[address]);
 useEffect(()=>{if(!isTauri())return;let disposed=false;let cleanup:(()=>void)|undefined;
  void listen<{symbol:string;watch:string;direction:string;targetPrice:string}>("exora-price-alert",({payload:a})=>{if(!document.hidden)notify({title:`${a.symbol} price alert`,message:`${a.watch} price is ${a.direction} ${a.targetPrice} USD`,kind:"info"});}).then(stop=>{if(disposed)stop();else cleanup=stop;});
  return()=>{disposed=true;cleanup?.();};
 },[]);
 useEffect(()=>{if(!isTauri())return;let disposed=false;let cleanup:(()=>void)|undefined;
 void listen<{message:string}>("exora-account-alert",({payload})=>{if(!document.hidden)notify({title:"Account update",message:payload.message,kind:"info"});}).then(stop=>{if(disposed)stop();else cleanup=stop;});
 return()=>{disposed=true;cleanup?.();};
 },[]);return null;
}
