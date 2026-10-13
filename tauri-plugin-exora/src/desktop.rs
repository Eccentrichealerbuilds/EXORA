use std::marker::PhantomData;
use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};
use crate::{models::*, Error};

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Exora<R>> {
    Ok(Exora(PhantomData))
}

/// The browser can preview the UI; native credentials and orientation require Android.
pub struct Exora<R: Runtime>(PhantomData<fn() -> R>);

impl<R: Runtime> Exora<R> {
    pub async fn set_live_session(&self, _enabled: bool) -> crate::Result<()> { Ok(()) }
    pub async fn watch_push(&self, _handler: tauri::ipc::Channel<serde_json::Value>) -> crate::Result<()> { Ok(()) }
    pub async fn unwatch_push(&self, _channel_id: u32) -> crate::Result<()> { Ok(()) }

    pub async fn get_push_status(&self) -> crate::Result<PushStatus> { Ok(PushStatus::default()) }
    pub async fn configure_push(&self, _enabled: bool, _wallet_address: Option<String>) -> crate::Result<PushStatus> { Err(Error::UnsupportedPlatform) }
    pub async fn take_push_verification(&self) -> crate::Result<PushVerificationInbox> { Ok(PushVerificationInbox::default()) }
    pub async fn take_push_inbox(&self) -> crate::Result<PushInbox> { Ok(PushInbox::default()) }

    pub async fn create_passkey(&self, _payload: PasskeyCreateRequest) -> crate::Result<CredentialResponse> {
        Err(Error::UnsupportedPlatform)
    }

    pub async fn get_credential(&self, _payload: PasskeyGetRequest) -> crate::Result<CredentialResponse> {
        Err(Error::UnsupportedPlatform)
    }

    pub async fn set_chart_fullscreen(&self, _enabled: bool) -> crate::Result<()> {
        Err(Error::UnsupportedPlatform)
    }
}
