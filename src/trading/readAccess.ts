import { invoke } from "@tauri-apps/api/core";
import { getEvmAddress } from "@category-labs/mera";
import { createSigningSession } from "../utils/signingSession";
import { withDeadline } from "../utils/withDeadline";

const pending = new Map<string, Promise<void>>();
export const pendingWalletData = (address: string) => pending.get(address.toLowerCase());

// Reuse the sign-in confirmation; the wallet key is wiped and never retained.
export function prepareWalletData(address: string, privateKey: Uint8Array): Promise<void> {
  const wallet = address.toLowerCase();
  const existing = pending.get(wallet);
  if (existing) { privateKey.fill(0); return existing; }
  const work = (async () => {
    const session = await createSigningSession(privateKey);
    try {
      if (getEvmAddress(session.publicKey).toLowerCase() !== wallet) throw new Error("The selected passkey belongs to another wallet.");
      if (await invoke<boolean>("has_perpl_read_key", { address })) return;
      const challenge = await invoke<{digest: string; address: string}>("begin_perpl_read_key", { address });
      if (!/^0x[0-9a-fA-F]{64}$/.test(challenge.digest) || challenge.address.toLowerCase() !== wallet)
        throw new Error("Perpl returned an invalid signing request.");
      const digest = Uint8Array.from(challenge.digest.slice(2).match(/../g)!, byte => parseInt(byte, 16));
      const signed = await withDeadline(session.signDigest(digest), 15_000, "Wallet setup did not finish. Please retry.");
      const signature = `0x${Array.from(signed.compact, byte => byte.toString(16).padStart(2, "0")).join("")}${(signed.recovery + 27).toString(16).padStart(2, "0")}`;
      await invoke("complete_perpl_read_key", { address, signature });
    } finally { session.end(); privateKey.fill(0); }
  })();
  pending.set(wallet, work);
  void work.finally(() => { if (pending.get(wallet) === work) pending.delete(wallet); }).catch(() => {});
  return work;
}
