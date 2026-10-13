// Shared only with the notification overlay so a locked session cannot expose its messages.
let locked = false;
const listeners = new Set<() => void>();
export const privacyLocked = () => locked;
export function subscribePrivacyLock(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setPrivacyLocked(value: boolean) {
  if (locked === value) return;
  locked = value;
  listeners.forEach(listener => listener());
}
