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
pub struct Exora<R: Runtime>(PhantomData<R>);

impl<R: Runtime> Exora<R> {
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
