import { prepareWalletData } from "../trading/readAccess";
import { getPasskeyPrfOutput, getEvmAddress} from "@category-labs/mera";
import {RP_ID} from "./constValues.ts";
import {tauriWebAuthnClient} from "./tauriWebAuthnConstruct.ts";
import {deriveEthereumPrivatekey} from "./derivePrivatekey.ts";
import {createPublicAccount, PublicAccount, savePublicAccount} from "./storageSaveAndLoad.ts";
import {createSigningSession} from "./signingSession.ts";

export async function chooseFromExistingPasskey(prepareData = false) {

      const result = await getPasskeyPrfOutput({
            rpId: RP_ID,
            webAuthnClient: tauriWebAuthnClient
      });

      const privateKey = deriveEthereumPrivatekey(result.prfOutput);
      const privateKeyCopy = new Uint8Array(privateKey);
      const session = await createSigningSession(privateKey);
      const address = getEvmAddress(session.publicKey);
      session.end()
      const createPublic = createPublicAccount(
            result.credentialId,
            undefined,
            address
      );
      savePublicAccount(createPublic)
      if (prepareData) { void prepareWalletData(address, privateKeyCopy).catch(() => {}); return new Uint8Array(); }
      return privateKeyCopy;
}

export async function chooseSpecificFromExisting(account: PublicAccount, prepareData = false) {
      const result = await getPasskeyPrfOutput({
            rpId: RP_ID,
            timeout: 15_000,
            credential:{
                  credentialId:account.credentialId,
                  transports: account.transports,
            },
            webAuthnClient: tauriWebAuthnClient
      });

      const privateKey = deriveEthereumPrivatekey(result.prfOutput);
      const privateKeyCopy = new Uint8Array(privateKey);
      const session = await createSigningSession(privateKey);
      const address = getEvmAddress(session.publicKey);
      session.end()

      const createPublic = createPublicAccount(
            result.credentialId,
            undefined,
            address
      );

      savePublicAccount(createPublic)

      if (prepareData) { void prepareWalletData(address, privateKeyCopy).catch(() => {}); return new Uint8Array(); }
      return privateKeyCopy;
}