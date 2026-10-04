import { useEffect, useState } from "react";
import { startFeed } from "./feed";
import type { ConnectionState, PriceUpdate } from "../types.ts";
import { errorText } from "../utils/errorText";

export function usePrices() {
      const [prices, setPrices] = useState<Record<number, PriceUpdate>>({});
      const [status, setStatus] = useState<ConnectionState>({
            state: "connecting",
            message: "Starting",
      });
      
      useEffect(() => {
            let stopped = false;
            let stopFeed: (() => void) | undefined;
            
            startFeed(
                  (price) => {
                        if (!stopped) setPrices(current => ({ ...current, [price.marketId]: price }));
                  },
                  (state) => { if (!stopped) setStatus(state); },
            ).then((stop) => {
                  if (stopped) {
                        stop();
                  } else {
                        stopFeed = stop;
                  }
            }).catch((error) => {
                  if (!stopped) {
                        setStatus({ state: "error", message: errorText(error) });
                  }
            });
            
            return () => {
                  stopped = true;
                  stopFeed?.();
            };
      }, []);
      
      return { prices, status };
}
