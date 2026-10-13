import { TradingSession } from "../trading/TradingSession";
import { PrivacyShield } from "../preferences/PrivacyShield";
import { Navigate, Outlet } from "react-router";
import { useSessionAddress } from "../utils/authSession";
import { loadPublicAccount } from "../utils/storageSaveAndLoad";

export function RequireSession() {
  const address = useSessionAddress();
  const account = loadPublicAccount();
  if (!address || account?.address.toLowerCase() !== address) {
    return <Navigate to="/" replace />;
  }
  return <PrivacyShield key={address}><TradingSession address={address}><Outlet /></TradingSession></PrivacyShield>;
}
