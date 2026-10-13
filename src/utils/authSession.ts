import { useSyncExternalStore } from "react";
import { disconnectPush } from "../notifications/pushService";
import { clearToasts } from "../notifications/store";

const SESSION_KEY = "exora.signedInAddress";
const SESSION_EVENT = "exora-session-changed";

export function startSession(address: string) {
  const previous = sessionStorage.getItem(SESSION_KEY);
  if (previous && previous !== address.toLowerCase()) clearToasts();
  sessionStorage.setItem(SESSION_KEY, address.toLowerCase());
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function signOut() {
  disconnectPush();
  clearToasts();
  sessionStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event(SESSION_EVENT));
}

function subscribe(listener: () => void) {
  window.addEventListener(SESSION_EVENT, listener);
  window.addEventListener("storage", listener);
  window.addEventListener("pageshow", listener);
  return () => {
    window.removeEventListener(SESSION_EVENT, listener);
    window.removeEventListener("storage", listener);
    window.removeEventListener("pageshow", listener);
  };
}

export function useSessionAddress() {
  return useSyncExternalStore(subscribe, () => sessionStorage.getItem(SESSION_KEY), () => null);
}
