export type MarketInfo = {
  id: number;
  symbol: string;
  name: string;
  priceDecimals: number;
  sizeDecimals: number;
  isOpen: boolean;
  initialMargin: number;
  maintenanceMargin: number;
  maxLeverageHundredths: number;
  makerFeeMicros: number;
  takerFeeMicros: number;
  minimumSettleAmount: string;
  orderTtlBlocks: number;
  price: string | null;
  markPrice: string | null;
  oraclePrice: string | null;
  previousPrice: string | null;
  bid: string | null;
  ask: string | null;
  volumeUsd: string | null;
  openInterest: string | null;
  fundingRate: number | null;
  updatedAtMs: number | null;
};

export type Candle = { time: number; open: string; close: string; high: string; low: string; volume: string; trades: number };

export type MarketEvent =
  | { type: "context"; head: number; markets: MarketInfo[] }
  | { type: "config"; market: MarketInfo }
  | { type: "state"; marketId: number; price: string; markPrice: string; oraclePrice: string;
      previousPrice: string; bid: string; ask: string; volumeUsd: string; openInterest: string; head: number | null }
  | { type: "funding"; marketId: number; rate: number }
  | { type: "candles"; marketId: number; resolution: number; snapshot: boolean; candles: Candle[] }
  | { type: "head"; block: number };
