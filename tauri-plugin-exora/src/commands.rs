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
