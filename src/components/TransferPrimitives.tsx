import React, { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { XIcon } from "lucide-react";

/* ───────────── Brand mark ───────────── */

export function BrandMark() {
  return (
    <div className="flex items-center gap-3" aria-label="Exora">
      <span className="relative inline-block h-[18px] w-[18px] rotate-45 rounded-[5px] bg-[#8873ff]" aria-hidden="true">
        <span className="absolute inset-[5px] rounded-[2px] bg-[#09070d]" />
      </span>
      <span className="font-display text-sm font-bold tracking-[0.22em]">EXORA</span>
    </div>);

}

/* ───────────── Token glyph ───────────── */

export function TokenGlyph({ glyph, color, large = false }: {glyph: string;color: string;large?: boolean;}) {
  return (
    <span className={`relative grid shrink-0 place-items-center ${large ? "h-11 w-11" : "h-10 w-10"}`} aria-hidden="true">
      <span
        className={`absolute rotate-45 ${large ? "h-8 w-8 rounded-[10px]" : "h-7 w-7 rounded-[9px]"}`}
        style={{ backgroundColor: color }} />
      
      <span className="relative font-display text-xs font-bold text-[#0a0710]">{glyph}</span>
    </span>);

}

/* ───────────── Avatar ───────────── */

export function AccountAvatar({ initial, large = false, muted = false }: {initial: string;large?: boolean;muted?: boolean;}) {
  return (
    <span className={`relative grid shrink-0 place-items-center ${large ? "h-10 w-10" : "h-6 w-6"}`} aria-hidden="true">
      <span
        className={`absolute rotate-45 ${large ? "h-7 w-7 rounded-[8px]" : "h-[18px] w-[18px] rounded-[5px]"} ${
        muted ? "bg-[#3a3352]" : "bg-[#8873ff]"}`
        } />
      
      <span
        className={`relative font-display font-bold uppercase ${large ? "text-xs" : "text-[10px]"} ${
        muted ? "text-[#d8d0f0]" : "text-[#0a0710]"}`
        }>
        
        {initial}
      </span>
    </span>);

}

/* ───────────── Bottom sheet ───────────── */

interface SheetProps {
  open: boolean;
  onClose: () => void;
  eyebrow: string;
  tone?: "default" | "error" | "success";
  labelledBy: string;
  viewKey: string;
  children: React.ReactNode;
}

const TONE = { default: "text-[#8873ff]", error: "text-[#ff8ea6]", success: "text-[#71f7b5]" } as const;

export function Sheet({ open, onClose, eyebrow, tone = "default", labelledBy, viewKey, children }: SheetProps) {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open &&
      <motion.div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}>
        
          <button
          type="button"
          aria-label="Close"
          tabIndex={-1}
          onClick={onClose}
          className="absolute inset-0 bg-[rgba(3,2,6,0.72)] backdrop-blur-sm" />
        
          <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          initial={reduceMotion ? { opacity: 0 } : { y: "100%" }}
          animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { y: "100%" }}
          transition={{ type: "spring", stiffness: 380, damping: 38 }}
          className="scrollbar-hidden relative max-h-[92dvh] w-full select-none overflow-y-auto rounded-t-[28px] border border-b-0 border-[rgba(230,224,255,0.16)] bg-[#0b0912] px-5 pt-3 text-[#f6f2ff] shadow-[0_-24px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.08)] sm:max-w-[440px] sm:rounded-[28px] sm:border-b sm:px-7 sm:pt-5"
          style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}>
          
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[rgba(230,224,255,0.18)] sm:hidden" aria-hidden="true" />
            <div className="mb-5 flex items-center justify-between">
              <span className={`font-mono text-[9px] uppercase tracking-[0.2em] ${TONE[tone]}`}>{eyebrow}</span>
              <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-8 w-8 place-items-center rounded-full border border-[rgba(230,224,255,0.14)] text-[#cfc7dc] outline-none transition-colors hover:bg-[rgba(255,255,255,0.06)] focus-visible:ring-2 focus-visible:ring-[#9b87ff]">
              
                <XIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
              key={viewKey}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
              
                {children}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        </motion.div>
      }
    </AnimatePresence>);

}

/* ───────────── Verifying screen ───────────── */

interface VerificationProgressProps {
  titleId: string;
  title: string;
  description: string;
  steps: string[];
}

export function VerificationProgress({ titleId, title, description, steps }: VerificationProgressProps) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="flex flex-col items-center py-4 text-center" role="status">
      <div className="relative grid h-28 w-28 place-items-center" aria-hidden="true">
        {[0, 1].map((ring) =>
        <motion.span
          key={ring}
          className="absolute h-16 w-16 rotate-45 rounded-[18px] border border-[rgba(136,115,255,0.6)]"
          animate={reduceMotion ? undefined : { scale: [1, 1.7], opacity: [0.7, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut", delay: ring * 0.9 }} />

        )}
        <motion.span
          className="absolute h-14 w-14 rounded-[16px] bg-[#8873ff] shadow-[0_0_36px_rgba(136,115,255,0.6)]"
          initial={{ rotate: 45 }}
          animate={reduceMotion ? undefined : { rotate: [45, 135, 225] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: [0.65, 0, 0.35, 1] }} />
        
        <span className="absolute h-7 w-7 rotate-45 rounded-[8px] bg-[#0a0710]" />
      </div>
      <h2 id={titleId} className="mt-4 font-display text-xl font-semibold text-[#f7f4ff]">
        {title}
      </h2>
      <p className="mt-1.5 max-w-[300px] text-sm leading-6 text-[#b8b0c8]">{description}</p>
      <ol className="mt-6 w-full space-y-2 text-left">
        {steps.map((step, index) =>
        <motion.li
          key={step}
          initial={reduceMotion ? false : { opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.24, delay: 0.15 + index * 0.35 }}
          className="flex items-center gap-3 rounded-[12px] border border-[rgba(230,224,255,0.08)] bg-[rgba(255,255,255,0.02)] px-3 py-2.5 font-mono text-[11px] text-[#cfc7dc]">
          
            <span className="text-[9px] text-[#8873ff]">0{index + 1}</span>
            {step}
            <motion.span
            className="ml-auto h-1.5 w-1.5 rounded-full bg-[#8873ff]"
            animate={reduceMotion ? undefined : { opacity: [0.25, 1, 0.25] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: index * 0.3 }} />
          
          </motion.li>
        )}
      </ol>
    </div>);

}
