export type PriceUpdate = {
      marketId: number;
      symbol: string;
      rawPrice: string;
      priceDecimals: number;
      price: string;
};

export type ConnectionState = {
      state: string;
      message: string;
};
