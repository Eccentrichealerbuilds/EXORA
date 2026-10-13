import { setPrivacyLocked } from "./lockState";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { authenticate } from "@tauri-apps/plugin-biometric";
import { FingerprintIcon } from "lucide-react";
import { loadPreferences, mobileDevice, preferencesSnapshot, usePreferences } from "./service";
import { signOut } from "../utils/authSession";
import { systemPromptActive, withSystemPrompt } from "./systemPrompt";
export function PrivacyShield({children}: {children: ReactNode}) {
 const preferences=usePreferences(); const [ready,setReady]=useState(false); const [locked,setLocked]=useState(false);
 const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const unlocking=useRef(false);
 useLayoutEffect(()=>{setPrivacyLocked(!ready||(locked&&preferences.lockOnReturn));},[ready,locked,preferences.lockOnReturn]);
 useEffect(()=>()=>setPrivacyLocked(false),[]);
 const load=()=>{setError("");void loadPreferences().then(value=>{setLocked(value.lockOnReturn&&mobileDevice());setReady(true);}).catch(()=>setError("Device preferences could not be loaded. Please retry."));};
 useEffect(()=>{load();const visibility=()=>{if(document.hidden&&preferencesSnapshot().lockOnReturn&&!unlocking.current&&!systemPromptActive())setLocked(true);};document.addEventListener("visibilitychange",visibility);return()=>document.removeEventListener("visibilitychange",visibility);},[]);
 const unlock=async()=>{if(unlocking.current)return;unlocking.current=true;setBusy(true);setError("");try{await withSystemPrompt(()=>authenticate("Unlock your EXORA session",{title:"Unlock EXORA",allowDeviceCredential:true}));setLocked(false);}catch{setError("Unlock canceled. Your session is still hidden.");}finally{unlocking.current=false;setBusy(false);}};
 return <>{ready&&<div inert={locked&&preferences.lockOnReturn?true:undefined} aria-hidden={locked&&preferences.lockOnReturn?true:undefined}>{children}</div>}
 {(!ready||(locked&&preferences.lockOnReturn))&&<div role="dialog" aria-modal="true" aria-label="Unlock EXORA" className="exora-design fixed inset-0 z-[2000] flex flex-col items-center justify-center gap-5 bg-canvas p-6 text-fg"><FingerprintIcon className="h-12 w-12 text-accent"/><h1 className="text-xl">{ready?"EXORA is locked":"Opening your session…"}</h1>{error&&<p role="alert" className="text-center text-sm text-muted">{error}</p>}{ready?<button disabled={busy} onClick={()=>void unlock()} className="min-h-12 w-full max-w-xs rounded border border-accent bg-accent text-ink">{busy?"Unlocking…":"Unlock with device"}</button>:error&&<button onClick={load}>Retry</button>}<button disabled={busy} onClick={signOut} className="min-h-11 text-sm text-muted">Sign out</button></div>}</>;
}
