import type { PasskeyCredentialTransport, WebAuthnClient} from "@category-labs/mera"
import {invoke} from "@tauri-apps/api/core"
import {numberArrayToUint8Array, uint8ArrayToNumberArray} from "./conversions.ts"

type NativeCredentialResponse = {
      credentialId: number[];
      prfEnabled?: boolean | null;
      prfOutput?:number[] | null;
      transports?: PasskeyCredentialTransport[] | null;
}

export const tauriWebAuthnClient: WebAuthnClient = {
      async createCredential(
            request: WebAuthnClient.CreateCredentialRequest
      ): Promise<WebAuthnClient.CreateCredentialResult> {

            const response = await invoke<NativeCredentialResponse>(
                  "plugin:exora|create_passkey", {
                        payload: {
                              rpId: request.rp.id,
                              rpName: request.rp.name,
                              userId: uint8ArrayToNumberArray(request.user.id),
                              userName: request.user.name,
                              displayName: request.user.displayName,
                              challenge: uint8ArrayToNumberArray(request.challenge),
                              algorithms: Array.from(request.algorithms),
                              prfSalt: uint8ArrayToNumberArray(request.prfSalt),
                              residentKey: request.residentKey,
                              userVerification: request.userVerification,
                              attestation: request.attestation,
                              timeout: request.timeout ?? null
                        }
                  }
            )

            const credentialId = numberArrayToUint8Array(
                  response.credentialId, "credential ID"
            )
            const createResult: {
                  credentialId: Uint8Array;
                  prfEnabled: boolean;
                  prfOutput?: Uint8Array;
                  transports?: readonly PasskeyCredentialTransport[];
            } = {
                  credentialId: credentialId,
                  prfEnabled: response.prfEnabled === true
            };

            if (response.prfOutput != null) {
                  createResult.prfOutput = numberArrayToUint8Array(
                        response.prfOutput, "PRF output"
                  )
            }

            if (response.transports != null) {
                  createResult.transports = response.transports
            }

            return createResult
      },

      async getCredential(
            request: WebAuthnClient.GetCredentialRequest
      ): Promise<WebAuthnClient.GetCredentialResult> {

            const allowedCredential = request.allowCredential;

            const response = await invoke<NativeCredentialResponse>(
                  "plugin:exora|get_credential", {
                        payload: {
                              rpId: request.rpId,
                              challenge: uint8ArrayToNumberArray(request.challenge),
                              credentialId: allowedCredential === undefined?null :
                                    uint8ArrayToNumberArray(allowedCredential.credentialId),
                              transports: allowedCredential?.transports === undefined ? null :
                                    Array.from(allowedCredential.transports),
                              prfSalt: uint8ArrayToNumberArray(request.prfSalt),
                              userVerification: request.userVerification,
                              timeout: request.timeout ?? null
                        }
                  }
            )

            const credentialId = numberArrayToUint8Array(response.credentialId, "Credential Id");
            const result: {
                  credentialId: Uint8Array;
                  prfOutput?: Uint8Array;
            }= {
                  credentialId: credentialId
            };

            if (response.prfOutput != null) {
                  result.prfOutput = numberArrayToUint8Array(response.prfOutput, "PRF Output");
            }
            return result;
      }

}