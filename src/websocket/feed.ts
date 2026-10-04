import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ConnectionState, PriceUpdate } from "../types.ts";
import type { MarketEvent } from "../trading/types.ts";

export async function startFeed(
      onPrice: (price: PriceUpdate) => void,
      onState: (state: ConnectionState) => void,
      onMarket: (event: MarketEvent) => void = () => {},
      candleMarket?: number,
      resolution?: number,
): Promise<() => void> {
      const stopListening = await listen<ConnectionState>("connection-state", (event) => {
            onState(event.payload);
      });
      
      const channel = new Channel<PriceUpdate>();
      channel.onmessage = onPrice;
      const marketChannel = new Channel<MarketEvent>();
      marketChannel.onmessage = onMarket;
      
      try {
            const id = await invoke<number>("start_feed", { onPrice: channel, onMarket: marketChannel,
                  candleMarket: candleMarket ?? null, resolution: resolution ?? null });
            return () => {
                  stopListening();
                  void invoke("stop_feed", { id });
            };
      } catch (error) {
            stopListening();
            throw error;
      }
      
}
