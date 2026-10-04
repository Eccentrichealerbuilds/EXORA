import { withDeadline } from "../utils/withDeadline";
import {invoke} from "@tauri-apps/api/core";

export async function broadcastTransaction(id: string, action?: string) {
      return withDeadline(invoke<string>("broadcast_transfer", {
            id: id,
            action,
      }), 40_000, "Transaction submitted or awaiting network acknowledgement. Check Activity before trying again.");
}
