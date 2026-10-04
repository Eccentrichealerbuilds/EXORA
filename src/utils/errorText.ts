/** Last boundary before an error reaches the webview. Rust supplies specific
 * contract messages; this catches transport and parser details from any
 * remaining plugin, network or stream failure. */
export function errorText(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error ?? "")).trim().replace(/^Error:\s*/i, "");
  if (!message) return "Something went wrong. Please try again.";
  if (message === "[object Object]") return "Something went wrong. Please try again.";
  if (/Transaction 0x[0-9a-fA-F]{64} was submitted/.test(message)) return message;
  if (/read access expired|\b401\b|unauthori[sz]ed/i.test(message)) return "Perpl wallet data access expired. Reconnect it to continue.";
  if (/\b429\b|rate.?limit|too many requests|\b-32614\b/i.test(message)) return "The network is busy. Please wait a moment and try again.";
  if (/insufficient funds for gas/i.test(message)) return "Get testnet MON for this wallet from faucet.monad.xyz to pay network fees, then retry.";
  if (/nonce too low|replacement transaction underpriced/i.test(message)) return "Another transaction is pending. Wait for it to confirm, then try again.";
  if (/execution reverted|revert data|\b-32\d{3}\b/i.test(message)) return "The contract rejected this request. Refresh your data and try again.";
  if (/server returned an error response|transport error|rpc error|json-rpc|failed to fetch|networkerror|connection reset|timed out|error code|request failed with status/i.test(message)) {
    return "Could not reach the network. Check your connection and try again.";
  }
  if (/\bHTTP\s+[45]\d\d\b/i.test(message)) return "The service is unavailable right now. Please try again shortly.";
  if (/^(?:serde|decode|deseriali[sz]|invalid type|expected value)/i.test(message) || /\babi (?:error|decode)|alloy::|reqwest::|tungstenite::/i.test(message)) {
    return "The service returned unexpected data. Refresh and try again.";
  }
  return message;
}
