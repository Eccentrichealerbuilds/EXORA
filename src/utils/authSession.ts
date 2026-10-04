import { useSyncExternalStore } from "react";

const SESSION_KEY = "exora.signedInAddress";
const SESSION_EVENT = "exora-session-changed";

export function startSession(address: string) {
  sessionStorage.setItem(SESSION_KEY, address.toLowerCase());
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function signOut() {
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
