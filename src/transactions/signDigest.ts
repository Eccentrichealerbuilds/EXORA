import {type Secp256k1SigningSession} from "@category-labs/mera";
import {invoke} from "@tauri-apps/api/core";


type TransactionHash = String;

export async function signTransactionDigest (
      id: string,
      session: Secp256k1SigningSession,
      digestHex:string
){
      if (!/^0x[0-9a-fA-F]{64}$/.test(digestHex)){
            throw new Error("Invalid Digest");
      }

      const digest = Uint8Array.from(
            digestHex.slice(2).match(/../g)!, byte =>
                  parseInt(byte, 16)
      );

      const signature = await session.signDigest(digest);

      const txHash: TransactionHash = await invoke<String>("finalize_transfer", {
            id: id,
            compact:Array.from(signature.compact),
            recovery: signature.recovery
      });

      return txHash;
}
