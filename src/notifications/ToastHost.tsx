import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { CheckIcon, FingerprintIcon, InfoIcon, ShieldAlertIcon, Volume2Icon, VolumeXIcon, XIcon } from "lucide-react";
import { dismissToast, notify, subscribeToasts, toastSnapshot, type ToastInput, type ToastItem } from "./store";
import { playToastSound, setSoundEnabled, soundEnabled, unlockSound } from "./sound";
import "./toast.css";

/** Bridge existing screen feedback into the shared overlay without duplicating it on re-render. */
export function ToastNotice(input: ToastInput) {
  const latest = useRef(input); latest.current = input;
  useEffect(() => {
    if (!input.message) return;
    const id = notify({ ...input, onDismiss: () => latest.current.onDismiss?.(),
      action: input.action ? { label: input.action.label, run: () => latest.current.action?.run() } : undefined });
    return () => dismissToast(id, false);
  }, [input.message, input.kind, input.title]);
  return null;
}

function ToastCard({ item, muted, toggleSound }: { item: ToastItem; muted: boolean; toggleSound: () => void }) {
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const opacity = useTransform(x, [-220, 0, 220], [0, 1, 0]);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const remaining = useRef(item.kind === "error" || item.action ? 12000 : 7000);
  const paused = hovered || focused || dragging || hidden;
  const kind = item.kind ?? "success";
  const title = item.title ?? (kind === "error" ? "Something went wrong" : kind === "info" ? "Update" : "All set");
  const Icon = kind === "passkey" ? FingerprintIcon : kind === "error" ? ShieldAlertIcon : kind === "info" ? InfoIcon : CheckIcon;
  const gradient = useId().replace(/:/g, "");
  useEffect(() => {
    const listener = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  }, []);
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(() => dismissToast(item.id), remaining.current);
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - started)); };
  }, [item.id, paused]);
  return <motion.article layout={!reduced} className="exora-toast" data-kind={kind}
    role={kind === "error" ? "alert" : "status"} aria-atomic="true"
    initial={{ opacity: 0, y: reduced ? 0 : -36, scale: reduced ? 1 : 0.94 }}
    animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduced ? 0 : -18, scale: reduced ? 1 : 0.96 }}
    transition={reduced ? { duration: 0.12 } : { type: "spring", stiffness: 390, damping: 31 }}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <motion.div className="exora-toast-swipe" style={{ x, opacity }} drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.8}
      onDragStart={() => setDragging(true)} onDragEnd={(_, info) => {
        setDragging(false);
        if (Math.abs(info.offset.x) > 75 || Math.abs(info.velocity.x) > 550) dismissToast(item.id);
      }}>
      <div className="exora-toast-badge" aria-hidden="true">
        <svg viewBox="0 0 80 88" className="exora-toast-hex"><defs><linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#c89bff"/><stop offset=".48" stopColor="#7134ea"/><stop offset="1" stopColor="#a875ff"/></linearGradient></defs><path d="M32 5 Q40 0 48 5 L69 18 Q77 22 77 32 L77 56 Q77 65 69 70 L48 83 Q40 88 32 83 L11 70 Q3 65 3 56 L3 32 Q3 23 11 18 Z" fill="#401480" fillOpacity=".7" stroke={`url(#${gradient})`} strokeWidth="1.5"/></svg>
        <Icon className="exora-toast-symbol" strokeWidth={1.65}/>
        <span className="exora-toast-seal">{kind === "error" ? <XIcon/> : kind === "info" ? <InfoIcon/> : <CheckIcon/>}</span>
      </div>
      <span className="exora-toast-divider" aria-hidden="true"/>
      <div className="exora-toast-copy"><p className="exora-toast-title">{title}</p><p className="exora-toast-message">{item.message}</p>
        {item.action && <button type="button" className="exora-toast-action" onClick={item.action.run}>{item.action.label} <span aria-hidden="true">↗</span></button>}
      </div>
      <div className="exora-toast-controls">
        <button type="button" className="exora-toast-close" aria-label="Dismiss notification" onClick={() => dismissToast(item.id)}><XIcon/></button>
        <button type="button" className="exora-toast-sound" aria-label={muted ? "Enable notification sounds" : "Mute notification sounds"} aria-pressed={!muted} onClick={toggleSound}>{muted ? <VolumeXIcon/> : <Volume2Icon/>}</button>
      </div>
    </motion.div>
  </motion.article>;
}

export function ToastHost() {
  const items = useSyncExternalStore(subscribeToasts, toastSnapshot, toastSnapshot);
  const [muted, setMuted] = useState(() => !soundEnabled());
  const sounded = useRef(new Set<number>());
  useEffect(() => {
    const unlock = () => unlockSound();
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, []);
  useEffect(() => {
    for (const item of items) if (!sounded.current.has(item.id)) {
      sounded.current.add(item.id); playToastSound(item.kind ?? "success");
    }
    if (sounded.current.size > 100) sounded.current = new Set(items.map(item => item.id));
  }, [items]);
  return createPortal(<section className="exora-toast-stack" aria-label="Notifications"><AnimatePresence initial={false}>
    {items.map(item => <ToastCard key={item.id} item={item} muted={muted} toggleSound={() => {
      unlockSound(); setSoundEnabled(muted); setMuted(!muted);
    }}/>) }
  </AnimatePresence></section>, document.body);
}
