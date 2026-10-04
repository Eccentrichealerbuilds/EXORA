import { type PointerEvent } from "react";
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { ArrowUpRightIcon } from "lucide-react";

interface InteractiveTokenCardProps {
      symbol: "AUSD" | "MON";
      name: string;
      color: string;
      still: string;
      base: string;
      emblem: string;
      balance: string;
      usdValue: string;
      disabled: boolean;
      index: number;
      onSend: () => void;
}

const spring = { stiffness: 190, damping: 24, mass: 0.55 };

export function InteractiveTokenCard({ symbol, name, color, still, base, emblem, balance, usdValue, disabled, index, onSend }: InteractiveTokenCardProps) {
      const reduceMotion = useReducedMotion();
      const rotateX = useSpring(0, spring);
      const rotateY = useSpring(0, spring);
      const emblemX = useTransform(rotateY, [-7, 7], [-8, 8]);
      const emblemY = useTransform(rotateX, [-5, 5], [7, -7]);
      const shineX = useMotionValue(75);
      const shineY = useMotionValue(20);
      const shineOpacity = useSpring(0, spring);
      const shine = useMotionTemplate`radial-gradient(circle at ${shineX}% ${shineY}%, ${color}55, transparent 62%)`;

      const reset = () => {
            rotateX.set(0);
            rotateY.set(0);
            shineOpacity.set(0);
      };
      const move = (event: PointerEvent<HTMLElement>) => {
            if (reduceMotion) return;
            if ((event.target as Element).closest("button")) { reset(); return; }
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2));
            const y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2));
            rotateX.set(-y * 5);
            rotateY.set(x * 7);
            shineX.set((x + 1) * 50);
            shineY.set((y + 1) * 50);
            shineOpacity.set(0.7);
      };

      return (
            <motion.article
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.32, delay: 0.1 + index * 0.08, ease: [0.22, 1, 0.36, 1] }}
                  style={reduceMotion ? undefined : { rotateX, rotateY, transformPerspective: 900 }}
                  onPointerDown={move}
                  onPointerEnter={move}
                  onPointerMove={move}
                  onPointerLeave={reset}
                  onPointerUp={reset}
                  onPointerCancel={reset}
                  className="relative isolate touch-pan-y cursor-grab overflow-hidden rounded-[22px] border border-[rgba(230,224,255,0.2)] bg-[#0a101f] p-3.5 shadow-[0_20px_60px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.14)] active:cursor-grabbing sm:p-4"
            >
                  {reduceMotion ? (
                        <img src={still} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-cover object-top" />
                  ) : (
                        <>
                              <img src={base} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-cover object-top" />
                              <motion.img src={emblem} alt="" aria-hidden="true" style={{ x: emblemX, y: emblemY }} className="pointer-events-none absolute inset-0 h-full w-full object-cover object-top" />
                              <motion.span aria-hidden="true" style={{ backgroundImage: shine, opacity: shineOpacity }} className="pointer-events-none absolute inset-0 mix-blend-screen" />
                        </>
                  )}
                  <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(3,5,13,0.46),rgba(3,5,13,0.12)_68%,transparent),linear-gradient(0deg,rgba(3,5,13,0.44),transparent_58%)]" />
                  <div className="relative z-10">
                        <div className="flex min-h-10 min-w-0 items-start">
                              <div className="min-w-0">
                                    <p className="font-display text-sm font-semibold leading-4 text-[#f7f4ff]">{symbol}</p>
                                    <p className="mt-1 truncate font-mono text-[9px] text-[#c1bbd1]">{name}</p>
                              </div>
                        </div>
                        <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.18em] text-[#8f879c]">Balance</p>
                        <p className="mt-1 truncate font-display text-[22px] font-semibold tabular-nums leading-7 text-[#fffaff] sm:text-2xl">{balance}</p>
                        <p className="mt-1.5 truncate font-mono text-[11px] text-[#cfc7dc]">{usdValue}</p>
                        <button type="button" disabled={disabled} onClick={onSend} aria-label={`Send ${symbol}`} className="mt-3.5 flex h-10 w-full items-center justify-between rounded-[12px] border border-[rgba(230,224,255,0.28)] bg-[rgba(5,7,18,0.56)] pl-3 pr-2 font-display text-[13px] font-semibold text-[#f1ecff] backdrop-blur-[2px] outline-none transition-colors hover:bg-[rgba(12,16,34,0.82)] focus-visible:ring-2 focus-visible:ring-[#b4a8ff] disabled:cursor-not-allowed disabled:opacity-40">
                              Send
                              <span className="grid h-6 w-6 place-items-center rounded-[8px]" style={{ backgroundColor: color }} aria-hidden="true">
                                    <ArrowUpRightIcon className="h-3.5 w-3.5 text-[#0a0710]" />
                              </span>
                        </button>
                  </div>
            </motion.article>
      );
}
