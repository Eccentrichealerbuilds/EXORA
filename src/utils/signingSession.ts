import {createSecp256k1SigningSession} from "@category-labs/mera"

export async function createSigningSession(privateKey: Uint8Array<ArrayBufferLike>) {
      const session = createSecp256k1SigningSession({
            privateKey: privateKey
      });
      privateKey.fill(0);
      return session;
}