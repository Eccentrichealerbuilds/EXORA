use std::{fs, io::Write, sync::Mutex};

use alloy::{primitives::{Address, B256}, providers::Provider};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

static FILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingReceipt {
    hash: String,
    address: String,
    action: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptStatus {
    pub action: String,
    pub state: String,
    pub hash: Option<String>,
}

fn path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|_| "Transaction storage is unavailable".to_string())?;
    fs::create_dir_all(&dir).map_err(|_| "Transaction storage is unavailable".to_string())?;
    Ok(dir.join("pending-perpl-transactions.json"))
}

fn read(app: &AppHandle) -> Result<Vec<PendingReceipt>, String> {
    match fs::read(path(app)?) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "Saved transaction status is damaged".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(_) => Err("Could not read pending transactions".into()),
    }
}

fn write(app: &AppHandle, values: &[PendingReceipt]) -> Result<(), String> {
    let target = path(app)?;
    let temporary = target.with_extension("tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(|_| "Could not save pending transaction".to_string())?;
    file.write_all(&serde_json::to_vec(values).map_err(|_| "Could not save pending transaction".to_string())?)
        .map_err(|_| "Could not save pending transaction".to_string())?;
    file.sync_all().map_err(|_| "Could not save pending transaction".to_string())?;
    fs::rename(temporary, target).map_err(|_| "Could not save pending transaction".to_string())
}

pub fn record(app: &AppHandle, address: Address, hash: B256, action: &str) -> Result<(), String> {
    if !matches!(action, "order" | "close" | "cancel" | "change" | "forwarding") { return Ok(()); }
    let _lock = FILE_LOCK.lock().map_err(|_| "Transaction storage is unavailable")?;
    let mut entries = read(app)?;
    if !entries.iter().any(|entry| entry.hash == hash.to_string()) {
        entries.push(PendingReceipt { hash: hash.to_string(), address: address.to_string(), action: action.to_owned() });
        write(app, &entries)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn recover_pending_perpl_transactions(app: AppHandle, address: String) -> Result<Vec<ReceiptStatus>, String> {
    let address: Address = address.parse().map_err(|_| "Invalid wallet address")?;
    let entries = {
        let _lock = FILE_LOCK.lock().map_err(|_| "Transaction storage is unavailable")?;
        read(&app)?
    };
    let provider = crate::provider::provider();
    let mut states = Vec::new();
    for entry in entries.into_iter().filter(|entry| entry.address == address.to_string()) {
        let hash: B256 = entry.hash.parse().map_err(|_| "Saved transaction hash is invalid")?;
        let receipt = provider.get_transaction_receipt(hash).await
            .map_err(|error| crate::user_error::rpc(error, "check a pending transaction"))?;
        states.push(ReceiptStatus {
            action: entry.action,
            state: match receipt.as_ref() { Some(receipt) if receipt.status() => "confirmed", Some(_) => "failed", None => "pending" }.into(),
            hash: receipt.map(|_| entry.hash),
        });
    }
    Ok(states)
}

#[tauri::command]
pub fn acknowledge_perpl_transaction(app: AppHandle, address: String, hash: String) -> Result<(), String> {
    let address: Address = address.parse().map_err(|_| "Invalid wallet address")?;
    let hash: B256 = hash.parse().map_err(|_| "Invalid transaction hash")?;
    let _lock = FILE_LOCK.lock().map_err(|_| "Transaction storage is unavailable")?;
    let mut entries = read(&app)?;
    entries.retain(|entry| entry.address != address.to_string() || entry.hash != hash.to_string());
    write(&app, &entries)
}
