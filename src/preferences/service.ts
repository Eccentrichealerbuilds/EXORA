import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { PrivacySettings } from "../design/pages/DataPrivacyScreen";
import { setSoundEnabled } from "../notifications/sound";
export const defaults: PrivacySettings = {dataSaver:true,keepRecentCharts:true,lockOnReturn:false,hideWalletInShares:true,hapticFeedback:true,notificationSounds:true};
let current = defaults;
let loaded: Promise<PrivacySettings> | null = null;
const listeners = new Set<() => void>();
export const preferencesSnapshot = () => current;
export function loadPreferences() {
 return loaded ??= (isTauri() ? invoke<PrivacySettings>("get_preferences") : Promise.resolve(defaults)).then(value => {current=value;setSoundEnabled(value.notificationSounds);listeners.forEach(f=>f());return value;}).catch(error=>{loaded=null;throw error;});
}
export async function savePreferences(value: PrivacySettings) {
 if (!isTauri()) throw new Error("Preferences can be saved in the installed EXORA app.");
 if (current.keepRecentCharts && !value.keepRecentCharts) await invoke("clear_read_cache");
 await invoke("save_preferences",{preferences:value});current=value;loaded=Promise.resolve(value);setSoundEnabled(value.notificationSounds);listeners.forEach(f=>f());
}
export function usePreferences() {
 const [value,setValue]=useState(current);
 useEffect(()=>{const update=()=>setValue(current);listeners.add(update);void loadPreferences().catch(()=>{});return()=>{listeners.delete(update);};},[]);
 return value;
}
export const mobileDevice = () => /Android|iPhone|iPad/i.test(navigator.userAgent) && isTauri();
