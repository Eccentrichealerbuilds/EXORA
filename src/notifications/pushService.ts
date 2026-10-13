import { invoke, isTauri } from "@tauri-apps/api/core";

export type PushStatus = { configured: boolean; enabled: boolean; projectId: string | null; installationId: string | null };
export const androidPush = () => isTauri() && /Android/i.test(navigator.userAgent);
export const getPushStatus = () => invoke<PushStatus>("plugin:exora|get_push_status");
export const configurePush = (enabled: boolean, walletAddress?: string) => invoke<PushStatus>("plugin:exora|configure_push", { enabled, walletAddress });

// Native preferences are cleared immediately, even when remote unregistration is offline.
export function disconnectPush() {
  if (androidPush()) {
    void configurePush(false).catch(() => {});
    void invoke("disconnect_remote_alerts").catch(() => {});
  }
}
