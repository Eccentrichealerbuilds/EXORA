import { useState } from "react";
import { useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { checkStatus, authenticate } from "@tauri-apps/plugin-biometric";
import { DataPrivacyScreen, type PrivacySettingKey } from "../design/pages/DataPrivacyScreen";
import { usePreferences, savePreferences, mobileDevice } from "../preferences/service";
import { notify } from "../notifications/store";
import { errorText } from "../utils/errorText";
import { AppTabs } from "../components/AppTabs";
export default function Preferences() {
 const settings=usePreferences();const navigate=useNavigate();const [busy,setBusy]=useState(false);
 const change=async(key:PrivacySettingKey,value:boolean)=>{
  if(busy)return;setBusy(true);
  try{
   if(key==='lockOnReturn'&&value){if(!mobileDevice()||!(await checkStatus()).isAvailable)throw new Error("Device authentication is not available on this device.");await authenticate("Enable EXORA privacy lock",{title:"Protect EXORA",allowDeviceCredential:true});}
   await savePreferences({...settings,[key]:value});
  }catch(cause){notify({kind:"error",message:errorText(cause)});}finally{setBusy(false);}
 };
 return <main className="exora-design mx-auto min-h-[100dvh] max-w-[540px] bg-canvas pb-24 text-fg" style={{paddingTop:"env(safe-area-inset-top)"}}>
  <DataPrivacyScreen settings={settings} onSettingChange={(key,value)=>void change(key,value)} historyLoadingLabel="On demand" onHistoryLoading={()=>navigate('/trade')}
   onBack={()=>navigate('/home')} onManageStorage={()=>void invoke("clear_read_cache").then(()=>notify({kind:"success",message:"Saved charts and read-only history cleared. Your keys and notes are unchanged."})).catch(cause=>notify({kind:"error",message:errorText(cause)}))} />
  <AppTabs active="home" />
 </main>;
}
