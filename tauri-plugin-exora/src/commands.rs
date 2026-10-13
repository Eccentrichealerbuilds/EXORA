use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::ExoraExt;
use crate::Result;

#[command]
pub(crate) async fn create_passkey<R: Runtime>(
	app: AppHandle<R>,
	payload: PasskeyCreateRequest,
) -> Result<CredentialResponse> {
	app.exora().create_passkey(payload).await
}

#[command]
pub async fn get_credential<R: Runtime>(
	app: AppHandle<R>,
	payload: PasskeyGetRequest,
) -> Result<CredentialResponse> {
	app.exora().get_credential(payload).await
}

#[command]
pub async fn set_chart_fullscreen<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<()> {
    app.exora().set_chart_fullscreen(enabled).await
}

#[command]
pub async fn get_push_status<R: Runtime>(app: AppHandle<R>) -> Result<PushStatus> {
    app.exora().get_push_status().await
}
#[command]
pub async fn configure_push<R: Runtime>(app: AppHandle<R>, enabled: bool, wallet_address: Option<String>) -> Result<PushStatus> {
    app.exora().configure_push(enabled, wallet_address).await
}

#[command]
pub async fn watch_push<R: Runtime>(app: AppHandle<R>, handler: tauri::ipc::Channel<serde_json::Value>) -> Result<()> {
    app.exora().watch_push(handler).await
}
#[command]
pub async fn unwatch_push<R: Runtime>(app: AppHandle<R>, channel_id: u32) -> Result<()> {
    app.exora().unwatch_push(channel_id).await
}

#[command]
pub async fn set_live_session<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<()> {
    app.exora().set_live_session(enabled).await
}
