import { notify } from "../notifications/store";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { FingerprintIcon, ShieldCheckIcon, XIcon } from "lucide-react";
import { useNavigate } from "react-router";
import {saveCreatedAccount} from "../utils/saveCreatedAccount.ts";
import type { PriceUpdate } from "../types.ts";

interface PasskeySheetProps {
      open: boolean;
      onClose: () => void;
      sortedPrices: PriceUpdate[];
      onCreated?: (address: string) => void;
}

export function PasskeySheet({ open, onClose, sortedPrices, onCreated }: PasskeySheetProps) {
      const navigate = useNavigate();
      const reduceMotion = Boolean(useReducedMotion());
      const [name, setName] = useState("");
      const [displayName, setDisplayName] = useState("");
      const nameIsValid = name.trim().length >= 2;
      const displayNameIsValid = displayName.trim().length >= 2;

      const createKey = async () => {
            if (!nameIsValid || !displayNameIsValid) return;
            const address = await saveCreatedAccount(displayName.trim(), name.trim());
            notify({ kind: "passkey", title: "Passkey created", message: "Your secure access key is ready." });
            if (onCreated) {
                  onCreated(address);
                  return;
            }
            navigate("/home", {
                  replace: true,
                  state: {
                        sortedPrices,
                  },
            });
      }

      useEffect(() => {
            if (open) {
                  setName("");
                  setDisplayName("");
            }
      }, [open]);

      useEffect(() => {
            if (!open) return;
            const onKeyDown = (event: KeyboardEvent) => {
                  if (event.key === "Escape") onClose();
            };
            window.addEventListener("keydown", onKeyDown);
            return () => window.removeEventListener("keydown", onKeyDown);
      }, [open, onClose]);

      return (
            <AnimatePresence>
                  {open && (
                        <motion.div
                              className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.2 }}
                        >
                              <button
                                    type="button"
                                    aria-label="Close passkey form"
                                    tabIndex={-1}
                                    onClick={onClose}
                                    className="absolute inset-0 bg-[rgba(3,2,6,0.72)] backdrop-blur-sm"
                              />
                              <motion.div
                                    role="dialog"
                                    aria-modal="true"
                                    aria-labelledby="passkey-title"
                                    initial={reduceMotion ? { opacity: 0 } : { y: "100%" }}
                                    animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
                                    exit={reduceMotion ? { opacity: 0 } : { y: "100%" }}
                                    transition={{ type: "spring", stiffness: 380, damping: 38 }}
                                    className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[28px] border border-b-0 border-[rgba(230,224,255,0.16)] bg-[#0b0912] px-5 pt-3 text-[#f6f2ff] shadow-[0_-24px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.08)] sm:max-w-[440px] sm:rounded-[28px] sm:border-b sm:px-7 sm:pt-5"
                                    style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}
                              >
                                    <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[rgba(230,224,255,0.18)] sm:hidden" aria-hidden="true" />
                                    <div className="mb-5 flex items-center justify-end">
                                          <button
                                                type="button"
                                                onClick={onClose}
                                                aria-label="Close"
                                                className="grid h-8 w-8 place-items-center rounded-full border border-[rgba(230,224,255,0.14)] text-[#cfc7dc] outline-none transition-colors hover:bg-[rgba(255,255,255,0.06)] focus-visible:ring-2 focus-visible:ring-[#9b87ff]"
                                          >
                                                <XIcon className="h-4 w-4" aria-hidden="true" />
                                          </button>
                                    </div>

                                    <form onSubmit={(event) => event.preventDefault()}>
                                          <h2 id="passkey-title" className="font-display text-2xl font-semibold text-[#f7f4ff]">Create your passkey</h2>
                                          <p className="mt-1.5 text-sm leading-6 text-[#b8b0c8]">
                                                A passkey replaces passwords. It is unlocked with your device biometrics or security key.
                                          </p>

                                          <div className="mt-5 flex items-center gap-3 rounded-[18px] border border-dashed border-[rgba(136,115,255,0.36)] bg-[rgba(136,115,255,0.06)] p-3">
                                                <span className="relative grid h-10 w-10 shrink-0 place-items-center" aria-hidden="true">
                                                      <span className="absolute h-7 w-7 rotate-45 rounded-[8px] bg-[#8873ff]" />
                                                      <span className="absolute h-4 w-4 rotate-45 rounded-[4px] bg-[#0a0710]" />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                      <span className="block truncate font-display text-sm font-semibold text-[#f1ecff]">{displayName.trim() || "Your display name"}</span>
                                                      <span className="block truncate font-mono text-[10px] text-[#a59db3]">{name.trim() || "Your name"}</span>
                                                </span>
                                                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#8873ff]">Preview</span>
                                          </div>

                                          <div className="mt-5 flex flex-col gap-3">
                                                <label className="block rounded-[16px] border border-[rgba(230,224,255,0.14)] bg-[rgba(255,255,255,0.03)] px-4 pb-2.5 pt-2.5 transition-[border-color,box-shadow] duration-200 focus-within:border-[#8873ff] focus-within:shadow-[0_0_0_4px_rgba(136,115,255,0.14)]">
                                                      <span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-[#a59db3]">Name</span>
                                                      <input
                                                            name="name"
                                                            value={name}
                                                            onChange={(event) => setName(event.target.value)}
                                                            placeholder="satoshi"
                                                            autoFocus
                                                            autoComplete="username"
                                                            className="mt-1 w-full min-w-0 bg-transparent font-display text-base text-[#f7f4ff] outline-none placeholder:text-[#5d5669]"
                                                      />
                                                </label>
                                                <label className="block rounded-[16px] border border-[rgba(230,224,255,0.14)] bg-[rgba(255,255,255,0.03)] px-4 pb-2.5 pt-2.5 transition-[border-color,box-shadow] duration-200 focus-within:border-[#8873ff] focus-within:shadow-[0_0_0_4px_rgba(136,115,255,0.14)]">
                                                      <span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-[#a59db3]">Display name</span>
                                                      <input
                                                            name="displayName"
                                                            value={displayName}
                                                            onChange={(event) => setDisplayName(event.target.value)}
                                                            placeholder="Satoshi Nakamoto"
                                                            autoComplete="nickname"
                                                            className="mt-1 w-full min-w-0 bg-transparent font-display text-base text-[#f7f4ff] outline-none placeholder:text-[#5d5669]"
                                                      />
                                                </label>
                                          </div>

                                          <button
                                                type="button"
                                                onClick={createKey}
                                                disabled={!nameIsValid || !displayNameIsValid}
                                                className="mt-6 flex h-14 w-full items-center justify-center gap-2.5 rounded-[18px] bg-[#8873ff] font-display text-[15px] font-semibold tracking-[0.03em] text-[#0a0710] shadow-[0_14px_36px_rgba(136,115,255,0.32),inset_0_1px_0_rgba(255,255,255,0.4)] outline-none transition-colors hover:bg-[#9a88ff] focus-visible:ring-2 focus-visible:ring-[#cfc5ff] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:bg-[#8873ff]"
                                          >
                                                <FingerprintIcon className="h-[18px] w-[18px]" aria-hidden="true" />
                                                Confirm &amp; create passkey
                                          </button>
                                          {(!nameIsValid || !displayNameIsValid) && (
                                                <ul className="mt-2 space-y-1 px-1 font-mono text-[10px] text-[#a59db3]" aria-live="polite">
                                                      {!nameIsValid && <li>Name must be at least 2 characters.</li>}
                                                      {!displayNameIsValid && <li>Display name must be at least 2 characters.</li>}
                                                </ul>
                                          )}
                                          <p className="mt-3 flex items-center justify-center gap-1.5 font-mono text-[10px] text-[#7d7589]">
                                                <ShieldCheckIcon className="h-3 w-3 text-[#71f7b5]" aria-hidden="true" />
                                                Your private key never leaves this device.
                                          </p>
                                    </form>
                              </motion.div>
                        </motion.div>
                  )}
            </AnimatePresence>
      );
}
