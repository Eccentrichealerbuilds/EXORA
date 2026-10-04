
export type Review = {
      id: string;
      digest: string;
      from: string;
      to: string;
      amount: string;
      asset: "MON" | "AUSD";
      chainId: number;
      nonce: number;
      gasLimit: number;
      maxFeePerGas: string;
      maxPriorityFeePerGas: string;
      maxNetworkFee: string;
}
