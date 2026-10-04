import {HDKey} from "@scure/bip32";
import {entropyToMnemonic, mnemonicToSeedSync} from "@scure/bip39";
import {wordlist} from "@scure/bip39/wordlists/english.js";


import { EVM_DERIVATION_PATH } from "./constValues";

export function deriveEthereumPrivatekey(prfOutput: Uint8Array):Uint8Array {
      if (prfOutput.length !== 32) {
            throw new Error("PRF output must be exactly 32 bytes")
      }

      const mnemonic = entropyToMnemonic(prfOutput, wordlist);

      const seed = mnemonicToSeedSync(mnemonic);

      const rootNode = HDKey.fromMasterSeed(seed);

      const ethereumNode = rootNode.derive(EVM_DERIVATION_PATH);

      const privateKey = ethereumNode.privateKey;

      if (privateKey === null) {
            throw new Error("Ethereum derivation produced no private key")
      }

      const privateKeyCopy = new Uint8Array(privateKey);

      ethereumNode.wipePrivateData();
      rootNode.wipePrivateData();
      seed.fill(0)
      prfOutput.fill(0)

      return privateKeyCopy;
}