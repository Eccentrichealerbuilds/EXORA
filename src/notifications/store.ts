export type ToastKind = "success" | "error" | "info" | "passkey";
export type ToastInput = { message: string; title?: string; kind?: ToastKind;
  action?: { label: string; run: () => void }; onDismiss?: () => void };
export type ToastItem = ToastInput & { id: number };
let items: ToastItem[] = [];
let sequence = 0;
const listeners = new Set<() => void>();
export const toastSnapshot = () => items;
export const subscribeToasts = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = () => listeners.forEach(listener => listener());
export function dismissToast(id: number, notify = true) {
  const item = items.find(item => item.id === id);
  items = items.filter(item => item.id !== id); publish();
  if (notify) item?.onDismiss?.();
}
export function notify(input: ToastInput) {
  const id = ++sequence;
  const overflow = items.length >= 3 ? items[items.length - 1] : null;
  items = [{ ...input, id }, ...items].slice(0, 3); publish();
  overflow?.onDismiss?.();
  return id;
}
