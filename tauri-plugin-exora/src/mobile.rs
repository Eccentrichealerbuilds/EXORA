use serde::de::DeserializeOwned;
use tauri::{
	plugin::{PluginApi, PluginHandle},
	AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_exora);

// initializes the Kotlin or Swift plugin classes
pub fn init<R: Runtime, C: DeserializeOwned>(
	_app: &AppHandle<R>,
	api: PluginApi<R, C>,
) -> crate::Result<Exora<R>> {
	#[cfg(target_os = "android")]
	let handle = api.register_android_plugin("com.plugin.exora", "ExoraPlugin")?;
	#[cfg(target_os = "ios")]
	let handle = api.register_ios_plugin(init_plugin_exora)?;
	Ok(Exora(handle))
}

/// Access to the exora APIs.
pub struct Exora<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Exora<R> {
    pub async fn set_chart_fullscreen(&self, enabled: bool) -> crate::Result<()> {
        #[derive(serde::Serialize)]
        struct Fullscreen { enabled: bool }
        self.0.run_mobile_plugin_async::<std::collections::HashMap<String, bool>>("setChartFullscreen", Fullscreen { enabled })
            .await.map(|_| ()).map_err(Into::into)
    }

	pub async fn create_passkey(
		&self,
		payload: PasskeyCreateRequest,
	) -> crate::Result<CredentialResponse> {
		self.0.run_mobile_plugin("createPasskeyCommand", payload)
			.map_err(Into::into)
	}

	pub async fn get_credential(
		&self,
		payload: PasskeyGetRequest,
	) -> crate::Result<CredentialResponse> {
		self.0.run_mobile_plugin_async("getCredentialCommand", payload)
			.await
			.map_err(Into::into)
	}
}
