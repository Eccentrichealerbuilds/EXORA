import { invoke } from "@tauri-apps/api/core";
import type { Review } from "./types.ts";

export type Asset = "MON" | "AUSD";
export type WalletBalances = { mon: string; ausd: string };

export function getWalletBalances(address: string) {
      return invoke<WalletBalances>("get_wallet_balances", { address });
}

export function buildTransaction(from: string, to: string, amount: string, asset: Asset) {
      return invoke<Review>("build_transaction", { from, to, amount, asset });
}

export function buildFaucetRequest(address: string) {
      return invoke<Review>("build_faucet_request", { address });
}
