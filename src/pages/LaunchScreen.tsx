import { useMemo, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRightIcon, ArrowUpRightIcon, FingerprintIcon, KeyRoundIcon } from 'lucide-react';
import { useNavigate } from 'react-router';
import { LiquidSurface } from "../components/LiquidSurface";
import { PasskeySheet } from "../components/PasskeySheet";
import ASTEROID_FIELD from "../assets/ASTEROID_FIELD.jpg";
import ASTEROID_FIELD_MOBILE from "../assets/ASTEROID_FIELD_MOBILE.jpg";
import {usePrices} from "../websocket/usePrices.ts";
import {loadPublicAccount} from "../utils/storageSaveAndLoad.ts";
import { startSession } from "../utils/authSession";
import {chooseFromExistingPasskey, chooseSpecificFromExisting} from "../utils/getCredentials.ts";



const LETTERS = {
      E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
      X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
      O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
      R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
      A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
} as const;

const appName = "EXORA";
const PASSKEY_BUTTON_CORNERS = [
      "left-2 top-2 border-l border-t rounded-tl-[4px]",
      "right-2 top-2 border-r border-t rounded-tr-[4px]",
      "bottom-2 left-2 border-b border-l rounded-bl-[4px]",
      "bottom-2 right-2 border-b border-r rounded-br-[4px]",
];

// Higher introHold => darkness before formation.
// Higher letterStagger or fragmentStagger => slower overall assembly.
// fragmentDuration at or below 0.3 for crisp, responsive motion.
const MOTION_TIMING = {
      introHold: 0.4,
      fragmentDuration: 0.3,
      letterStagger: 0.2,
      fragmentStagger: 0.028,
      taglineDelay: 2.35,
      interfaceDelay: 2.70,
      backgroundDrift: 36,
} as const;

// I just keep toggling everything here till it actual suits me, lmao...not sure if I can recreate this shit
function getFragment(letterIndex: number, row: number, column: number) {
      const seed = letterIndex * 83 + row * 29 + column * 47;
      const angle = (seed * 137.5 * Math.PI) / 180;
      const radius = 240 + (seed % 360);
      const staggerPosition = (row * 5 + column + seed) % 24;

      return {
            id: `${letterIndex}-${row}-${column}`,
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius * 0.62,
            rotate: (seed % 2 ? 1 : -1) * (150 + (seed % 240)),
            delay:
                  MOTION_TIMING.introHold +
                  letterIndex * MOTION_TIMING.letterStagger +
                  staggerPosition * MOTION_TIMING.fragmentStagger,
      };
}




export default function LaunchScreen() {
      const navigate = useNavigate();
      const [passkeySheetOpen, setPasskeySheetOpen] = useState(false);
      const signIn = async () => {
            const publicAccount = loadPublicAccount();
            // const [name, setName] = useState("");
            // const [displayName, setDisplayName] = useState("");
            if (publicAccount !== null) {
                  await chooseSpecificFromExisting(publicAccount);
            } else {
                  await chooseFromExistingPasskey();
            }
            const signedInAccount = loadPublicAccount();
            if (!signedInAccount) throw new Error("Sign-in did not return a wallet.");
            startSession(signedInAccount.address);
            navigate("/home", { replace: true, state: { sortedPrices } });
      }
      
      const { prices, status } = usePrices();
      // @ts-ignore
      const sortedPrices = Object.values(prices).sort(
            (left, right) => left.marketId - right.marketId,
      );
      
      const marketLabel = status.state === "connected" ? "Markets live"
            : sortedPrices.length > 0 ? "Reconnecting"
            : status.state === "error" ? "Markets unavailable" : "Fetching data";
      let marketConnecting;
      if (status.state === "connected") {
            marketConnecting = "h-1.5 w-1.5 rounded-full bg-[#71f7b5] shadow-[0_0_12px_rgba(113,247,181,0.8)]";
      }else{
            marketConnecting = "h-1.5 w-1.5 rounded-full bg-[#f4fa48] shadow-[0_0_12px_rgba(113,247,181,0.8)]"
      }

      useEffect(() => {
            const timer = setInterval(() => {
                  // 
            }, 1000)

            return () => { clearInterval(timer) }
      }, [])

      const reduceMotion = useReducedMotion();

      const fragments = useMemo(
            () =>
                  appName.split("").map((letter, letterIndex) => ({
                        letter,
                        cells: LETTERS[letter as keyof typeof LETTERS].flatMap((row, rowIndex) =>
                              row.split("").map((cell, columnIndex) => ({
                                    active: cell === "1",
                                    row: rowIndex,
                                    column: columnIndex,
                                    ...getFragment(letterIndex, rowIndex, columnIndex),
                              })),
                        ),
                  })),
            [],
      );
      return (
            <main className="relative select-none flex h-screen w-full overflow-hidden bg-[#050407] text-[#f6f2ff]">
                  <motion.div
                        aria-hidden="true"
                        className="absolute inset-0"
                        initial={{ scale: 1.04, x: 0, y: 0 }}
                        animate={reduceMotion ? { scale: 1.04 } : { scale: [1.04, 1.09, 1.04], x: [0, -10, 0], y: [0, 18, 0] }}
                        transition={{ duration: MOTION_TIMING.backgroundDrift, repeat: Infinity, ease: "linear" }}
                  >
                        <picture className="block h-full w-full">
                              <source media="(min-width: 768px)" srcSet={ASTEROID_FIELD} />
                              <img
                                    src={ASTEROID_FIELD_MOBILE}
                                    alt=""
                                    className="block h-full w-full object-cover object-center opacity-90 md:opacity-70"
                              />
                        </picture>
                  </motion.div>
                  <div aria-hidden="true" className="absolute inset-0 bg-[rgba(5,4,7,0.26)] md:bg-[rgba(5,4,7,0.54)]" />
                  <motion.div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 z-30 bg-[#050407]"
                        initial={reduceMotion ? false : { opacity: 0.82 }}
                        animate={{ opacity: 0 }}
                        transition={{ duration: 0.28, delay: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  />

                  <motion.header
                        initial={reduceMotion ? false : { opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.28, delay: reduceMotion ? 0 : MOTION_TIMING.interfaceDelay, ease: [0.22, 1, 0.36, 1] }}
                        className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 pb-4 sm:px-8 lg:px-12 lg:pb-8"
                        style={{ paddingTop: "max(18px, env(safe-area-inset-top))" }}
                  >
                        <div className="flex items-center gap-3" aria-label="Exora">
                              {/* This Logo in the top left Corner */}
                              <span className="relative inline-block h-[18px] w-[18px] rotate-45 rounded-[5px] bg-[#8873ff]" aria-hidden="true">
                                    <span className="absolute inset-[5px] rounded-[2px] bg-[#09070d]" />
                              </span>
                              {/* EXORA TITLE IN THE TOP LEFT CORNER */}
                              <span className="font-display text-sm font-bold tracking-[0.22em]">EXORA</span>
                        </div>
                        <div className={status.state === "connected" ?
                        "flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#71f7b5] sm:text-xs" :
                        "flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#f4fa48] sm:text-xs"}>
                              {/* Green light in the top right corner */}
                              <span className={marketConnecting}></span>
                              {marketLabel}
                        </div>
                  </motion.header>
                  <section className="relative z-10 flex h-full w-full flex-col items-center justify-center overflow-y-auto px-3 pb-24 pt-16 sm:overflow-visible sm:px-8 sm:pb-28 sm:pt-24">

                        <motion.div
                              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.26, delay: reduceMotion ? 0 : MOTION_TIMING.taglineDelay, ease: [0.22, 1, 0.36, 1] }}
                              className="mb-4 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.2em] text-[#d0c8dc] sm:mb-7 sm:gap-3 sm:text-xs sm:tracking-[0.24em]"
                        >
                              <span className="h-px w-7 bg-[#7964ff]" />
                              Perpetual markets, unbound
                              <span className="h-px w-7 bg-[#7964ff]" />
                        </motion.div>

                        <h1 className="sr-only">EXORA</h1>
                        <div
                              aria-hidden="true"
                              className="flex w-full max-w-5xl items-center justify-center gap-2 sm:gap-4 md:gap-6 lg:gap-8"
                        >
                              {fragments.map(({ letter, cells }, letterIndex) => (
                                    <div
                                          key={`${letter}-${letterIndex}`}
                                          className="grid aspect-[5/7] w-12 grid-cols-5 gap-1 sm:w-20 sm:gap-2 lg:w-32"
                                    >
                                          {cells.map((cell) =>
                                                cell.active ? (
                                                      <motion.span
                                                            key={cell.id}
                                                            className="relative block w-[78%] aspect-square place-self-center rounded-[24%] bg-[#8873ff] shadow-[0_0_8px_rgba(121,100,255,0.4)] sm:w-[72%] sm:shadow-[0_0_14px_rgba(121,100,255,0.48)]"
                                                            initial={
                                                                  reduceMotion
                                                                        ? false
                                                                        : { opacity: 0, x: cell.x, y: cell.y, rotate: cell.rotate, scale: 0.58 }
                                                            }
                                                            animate={{
                                                                  opacity: [0, 1, 1],
                                                                  x: [cell.x, cell.x * 0.06, 0],
                                                                  y: [cell.y, cell.y * 0.06, 0],
                                                                  rotate: [cell.rotate, 52, 45],
                                                                  scale: [0.58, 1.14, 1],
                                                            }}
                                                            transition={{
                                                                  duration: MOTION_TIMING.fragmentDuration,
                                                                  delay: reduceMotion ? 0 : cell.delay,
                                                                  times: [0, 0.82, 1],
                                                                  ease: [0.22, 1, 0.36, 1],
                                                            }}
                                                      >
                                                            <span className="absolute inset-[28%] rounded-[20%] bg-[#0a0710] shadow-[inset_0_0_3px_rgba(255,255,255,0.12)]" />
                                                      </motion.span>
                                                ) : (
                                                      <span key={cell.id} />
                                                ),
                                          )}
                                    </div>
                              ))}
                        </div>
                        <motion.div
                              aria-hidden="true"
                              className="mt-4 h-px w-full max-w-2xl origin-center bg-[#8873ff] sm:mt-5"
                              initial={reduceMotion ? false : { opacity: 0, scaleX: 0.04 }}
                              animate={{ opacity: [0, 1, 0], scaleX: [0.04, 1, 1] }}
                              transition={{ duration: 0.28, delay: reduceMotion ? 0 : MOTION_TIMING.taglineDelay - 0.18, times: [0, 0.64, 1], ease: [0.22, 1, 0.36, 1] }}
                        />
                        <motion.div
                              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.28, delay: reduceMotion ? 0 : MOTION_TIMING.taglineDelay + 0.18, ease: [0.22, 1, 0.36, 1] }}
                              className="mt-2 flex w-full flex-col items-center gap-6 text-center sm:mt-4 sm:gap-7"
                        >
                              <p className="max-w-[310px] text-xs leading-5 text-[#d0c8dc] sm:max-w-lg sm:text-base sm:leading-6">
                                    The edge of the market. Infinite positions. One decisive execution layer.
                              </p>
                              <div className="flex w-full max-w-[340px] flex-col gap-2.5">
                              <motion.button
                                    type="button"
                                    onClick={() => setPasskeySheetOpen(true)}
                                    whileTap={reduceMotion ? undefined : { scale: 0.975 }}
                                    transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                                    className="group relative flex h-[68px] w-full items-center gap-3 overflow-hidden rounded-[22px] border border-[rgba(230,224,255,0.38)] bg-[rgba(10,8,17,0.46)] pl-2.5 pr-3 text-left shadow-[0_18px_50px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.24)] outline-none backdrop-blur-2xl transition-[border-color,box-shadow] duration-200 hover:border-[rgba(242,238,255,0.64)] focus-visible:ring-2 focus-visible:ring-[#9b87ff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050407]"
                              >
                                    <LiquidSurface intensity={0.86} speed={0.7} />
                                    {PASSKEY_BUTTON_CORNERS.map((corner) => (
                                          <span key={corner} aria-hidden="true" className={`pointer-events-none absolute z-10 h-1.5 w-1.5 border-[rgba(183,168,255,0.7)] ${corner}`} />
                                    ))}
                                    <span className="relative z-10 grid h-12 w-12 shrink-0 place-items-center" aria-hidden="true">
                                          <span className="absolute h-9 w-9 rotate-45 rounded-[11px] bg-[#8873ff] shadow-[0_0_22px_rgba(136,115,255,0.55)] transition-transform duration-300 group-hover:rotate-[135deg]" />
                                          <span className="absolute h-[22px] w-[22px] rotate-45 rounded-[6px] bg-[#0a0710] transition-transform duration-300 group-hover:rotate-[135deg]" />
                                          <FingerprintIcon className="relative h-3.5 w-3.5 text-[#cfc5ff]" />
                                    </span>
                                    <span className="relative z-10 flex min-w-0 flex-1 flex-col">
                                          <span className="font-display text-[15px] font-semibold tracking-[0.04em] text-[#f7f4ff]">Create passkey</span>
                                          <span className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-[0.16em] text-[#b8b0c8]">Face · Fingerprint · Key</span>
                                    </span>
                                    <span aria-hidden="true" className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[rgba(240,235,255,0.26)] bg-[rgba(255,255,255,0.08)] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]">
                                          <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                                    </span>
                              </motion.button>
                              <motion.button
                                    type="button"
                                    onClick={signIn}
                                    whileTap={reduceMotion ? undefined : { scale: 0.98 }}
                                    transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                                    className="group relative flex h-12 w-full max-w-[340px] items-center overflow-hidden rounded-[16px] border border-[rgba(230,224,255,0.16)] bg-[rgba(5,4,7,0.32)] text-left outline-none backdrop-blur-xl transition-colors duration-200 hover:border-[rgba(230,224,255,0.34)] hover:bg-[rgba(20,16,32,0.5)] focus-visible:ring-2 focus-visible:ring-[#9b87ff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050407]"
                              >
                                    <span className="grid h-full w-12 shrink-0 place-items-center border-r border-[rgba(230,224,255,0.14)]" aria-hidden="true">
                                          <KeyRoundIcon className="h-4 w-4 text-[#b8a9ff]" />
                                    </span>
                                    <span className="flex flex-1 items-baseline gap-2 px-3.5">
                                          <span className="font-display text-sm font-semibold tracking-[0.04em] text-[#f1ecff]">Sign in</span>
                                          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#8f879c]">Existing passkey</span>
                                    </span>
                                    <span className="relative mr-3.5 h-4 w-4 shrink-0 overflow-hidden" aria-hidden="true">
                                          <ArrowUpRightIcon className="absolute inset-0 h-4 w-4 text-[#cfc7dc] transition-transform duration-300 group-hover:-translate-y-4 group-hover:translate-x-4" />
                                          <ArrowUpRightIcon className="absolute inset-0 h-4 w-4 -translate-x-4 translate-y-4 text-[#cfc7dc] transition-transform duration-300 group-hover:translate-x-0 group-hover:translate-y-0" />
                                    </span>
                                    <span aria-hidden="true" className="absolute bottom-0 left-12 right-0 h-px origin-left scale-x-0 bg-[#8873ff] transition-transform duration-300 group-hover:scale-x-100" />
                              </motion.button>
                              </div>
                        </motion.div>
                  </section>
                  <motion.aside
                        aria-label="Perpetual market snapshot"
                        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.28, delay: reduceMotion ? 0 : MOTION_TIMING.interfaceDelay, ease: [0.22, 1, 0.36, 1] }}
                        className="absolute inset-x-3 z-20 mx-auto max-w-4xl overflow-hidden rounded-[24px] border border-[rgba(230,224,255,0.28)] bg-[rgba(6,5,11,0.42)] shadow-[0_28px_90px_rgba(0,0,0,0.66),inset_0_1px_0_rgba(255,255,255,0.2),inset_0_-1px_0_rgba(100,80,190,0.12)] backdrop-blur-2xl backdrop-contrast-125 sm:inset-x-8 sm:flex sm:items-stretch"
                        style={{ bottom: "max(12px, env(safe-area-inset-bottom))" }}
                  >
                        <LiquidSurface intensity={1} speed={0.55} />
                        <div aria-hidden="true" className="pointer-events-none absolute inset-x-6 top-0 z-10 h-px bg-[rgba(245,241,255,0.4)]" />
                        <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-8 right-16 z-10 h-px bg-[rgba(126,105,225,0.16)]" />

                        <div className="relative z-10 flex items-center justify-between border-b border-[rgba(218,210,255,0.12)] px-3 py-2.5 sm:hidden">
                              <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-[#b5adbf]">Perpetual markets</span>
                              <span className={status.state === "connected" ?
                              "flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.14em] text-[#71f7b5]":
                              "flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.14em] text-[#f4fa48]"}>
                                    <span className={status.state === "connected" ?
                                    "h-1 w-1 rounded-full bg-[#71f7b5] shadow-[0_0_8px_rgba(113,247,181,0.9)]":
                                    "h-1 w-1 rounded-full bg-[#f4fa48] shadow-[0_0_8px_rgba(113,247,181,0.9)]"} />
                                    {marketLabel}
                              </span>
                        </div>
                        <div className="relative z-10 grid grid-cols-3 sm:contents">
                              {sortedPrices.filter(update => update.symbol.includes("MON")
                                    || update.symbol.includes("ETH")
                                    || update.symbol.includes("SOL")
                                    ).map((update) => (
                                          <div key={update.marketId} className="flex min-w-0 flex-col gap-1.5 border-r border-[rgba(218,210,255,0.12)] px-3 py-3 last:border-r-0 sm:flex-1 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4">
                                                <span className="truncate font-mono text-[8px] tracking-[0.08em] text-[#b8b0c4] sm:text-[11px]">{update.symbol}</span>
                                                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                                                      <span className="truncate font-mono text-[10px] font-medium text-[#fffaff] sm:text-xs">{update.price}</span>
                                                </div>
                                          </div>
                                    ))
                              }
                        </div>
                  </motion.aside>
                  <PasskeySheet open={passkeySheetOpen} onClose={() => setPasskeySheetOpen(false)} sortedPrices={sortedPrices} />
            </main>
      )
}
