import {createPasskey } from "./createPasskey.ts";
import {savePublicAccount, createPublicAccount} from "./storageSaveAndLoad.ts";
import {deriveEthereumPrivatekey} from "./derivePrivatekey.ts";
import {createSigningSession} from "./signingSession.ts";
import {getEvmAddress} from "@category-labs/mera"
import { startSession } from "./authSession";

export async function saveCreatedAccount(displayName: string, name: string) {
      const createAccount = await createPasskey(displayName, name);
      const privateKey = deriveEthereumPrivatekey(createAccount.prfOutput);
      const session = await createSigningSession(privateKey);
      const address = getEvmAddress(session.publicKey);
      session.end()
      const createPublic = createPublicAccount(
            createAccount.credentialId,
            createAccount.transports,
            address
      );
      savePublicAccount(createPublic)
      startSession(address);
      return address;
}
