import {EvmAddress, PasskeyCredentialTransport} from "@category-labs/mera";
import {ACCOUNT_STORAGE_KEY, EVM_DERIVATION_PATH, PRF_SALT, RP_ID} from "./constValues.ts"

export type PublicAccount = {
      version: 1;

      rpId: string;

      credentialId: string;

      transports?: PasskeyCredentialTransport[];

      address: EvmAddress;

      derivationPath: string;

      prfSalt: string;
};

export function createPublicAccount(
      credentialId: string,
      transports: readonly PasskeyCredentialTransport[] | undefined,
      address: EvmAddress
): PublicAccount {
      const account: PublicAccount = {
            version: 1,
            rpId: RP_ID,
            credentialId: credentialId,
            address: address,
            derivationPath: EVM_DERIVATION_PATH,
            prfSalt: PRF_SALT,
      }
      if (transports !== undefined) {
            account.transports = Array.from(transports)
      }
      return account
}

export function savePublicAccount(
      account: PublicAccount
) {
      const json = JSON.stringify(account);

      localStorage.setItem(ACCOUNT_STORAGE_KEY, json);
}

export function loadPublicAccount() {
      const json = localStorage.getItem(ACCOUNT_STORAGE_KEY);
      if (json === null) {
            return null;
      }
      return JSON.parse(json) as PublicAccount;
}
