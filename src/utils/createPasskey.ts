import {createPasskeyWithPrfOutput} from "@category-labs/mera"
import {tauriWebAuthnClient} from "./tauriWebAuthnConstruct.ts";
import {RP_ID} from "./constValues.ts";


export async function createPasskey(displayName: string, name: string) {
      try {
            return await createPasskeyWithPrfOutput({
                  rp: {
                        id: RP_ID,
                        name: "Exora",
                  },
                  user: {
                        displayName: displayName,
                        name: name,
                  },
                  webAuthnClient: tauriWebAuthnClient,
            })

      }catch(error) {

            throw new Error(JSON.stringify(error));
      }
}