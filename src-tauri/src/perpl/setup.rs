use alloy::{primitives::{utils::format_units, Address}, providers::Provider};
use perpl_sdk::abi::dex::Exchange;
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    exists: bool,
    has_mon: bool,
    has_ausd: bool,
    minimum_open: Option<String>,
}

// A small account check for Home; no positions, market scan, history or API key.
#[tauri::command]
pub async fn get_perpl_setup(address: String) -> Result<SetupStatus, String> {
    let owner: Address = address.parse().map_err(|_| "Invalid wallet address")?;
    tokio::time::timeout(Duration::from_secs(15), async {
        let provider = crate::provider::provider();
        let exchange = Exchange::new(super::exchange_address(), provider.clone());
        match exchange.getAccountByAddr(owner).call().await {
            Ok(_) => return Ok(SetupStatus { exists: true, has_mon: false, has_ausd: false, minimum_open: None }),
            Err(error) if super::account_missing(&error) => {},
            Err(error) => return Err(crate::user_error::contract(error, "check your trading setup")),
        }
        let minimum_call = exchange.getMinAccountOpenCNS();
        let (mon, ausd, minimum) = tokio::try_join!(
            async { provider.get_balance(owner).await.map_err(|e| crate::user_error::rpc(e, "check your MON balance")) },
            crate::transaction::wallet_balances::ausd_balance(&provider, owner),
            async { minimum_call.call().await.map_err(|e| crate::user_error::contract(e, "check the account minimum")) },
        )?;
        Ok(SetupStatus {
            exists: false,
            has_mon: !mon.is_zero(),
            has_ausd: !ausd.is_zero() && ausd >= minimum,
            minimum_open: Some(format_units(minimum, 6).map_err(|_| "Could not format the account minimum")?),
        })
    }).await.map_err(|_| "Could not check your trading setup. Check your connection and try again".to_string())?
}
