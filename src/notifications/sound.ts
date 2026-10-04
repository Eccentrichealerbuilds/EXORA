import type { ToastKind } from "./store";
const key = "exora.notificationSound";
let context: AudioContext | null = null;
export function soundEnabled() {
  try { return localStorage.getItem(key) !== "off"; } catch { return true; }
}
export function setSoundEnabled(enabled: boolean) {
  try { localStorage.setItem(key, enabled ? "on" : "off"); } catch { /* Storage may be unavailable. */ }
}
export function unlockSound() {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume().catch(() => {});
  } catch { /* Web Audio is optional. */ }
}
let lastSound = 0;
export function playToastSound(kind: ToastKind) {
  if (!soundEnabled() || !context || context.state !== "running" || Date.now() - lastSound < 450) return;
  lastSound = Date.now();
  const now = context.currentTime;
  const notes = kind === "error" ? [523.25, 440] : kind === "info" ? [659.25, 880] : [880, 1318.51];
  notes.forEach((frequency, index) => {
    const oscillator = context!.createOscillator();
    const gain = context!.createGain();
    const start = now + index * 0.095;
    oscillator.type = "sine"; oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.045, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
    oscillator.connect(gain); gain.connect(context!.destination);
    oscillator.start(start); oscillator.stop(start + 0.45);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  });
}
