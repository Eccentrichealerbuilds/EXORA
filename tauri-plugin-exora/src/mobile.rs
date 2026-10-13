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
    pub async fn set_live_session(&self, enabled: bool) -> crate::Result<()> {
        self.0.run_mobile_plugin_async::<serde_json::Value>("setLiveSession", serde_json::json!({"enabled":enabled})).await.map(|_| ()).map_err(Into::into)
    }
    pub async fn watch_push(&self, handler: tauri::ipc::Channel<serde_json::Value>) -> crate::Result<()> {
        #[derive(serde::Serialize)] struct Args { event: &'static str, handler: tauri::ipc::Channel<serde_json::Value> }
        self.0.run_mobile_plugin_async::<serde_json::Value>("registerListener", Args { event: "pushInboxChanged", handler }).await.map(|_| ()).map_err(Into::into)
    }
    pub async fn unwatch_push(&self, channel_id: u32) -> crate::Result<()> {
        self.0.run_mobile_plugin_async::<serde_json::Value>("removeListener", serde_json::json!({"event":"pushInboxChanged", "channelId":channel_id})).await.map(|_| ()).map_err(Into::into)
    }

    pub async fn get_push_status(&self) -> crate::Result<PushStatus> {
        self.0.run_mobile_plugin_async("getPushStatus", ()).await.map_err(Into::into)
    }
    pub async fn configure_push(&self, enabled: bool, wallet_address: Option<String>) -> crate::Result<PushStatus> {
        #[derive(serde::Serialize)] #[serde(rename_all="camelCase")] struct Options { enabled: bool, wallet_address: Option<String> }
        self.0.run_mobile_plugin_async("configurePush", Options { enabled, wallet_address }).await.map_err(Into::into)
    }
    pub async fn take_push_verification(&self) -> crate::Result<PushVerificationInbox> {
        self.0.run_mobile_plugin_async("takePushVerification", ()).await.map_err(Into::into)
    }
    pub async fn take_push_inbox(&self) -> crate::Result<PushInbox> {
        self.0.run_mobile_plugin_async("takePushInbox", ()).await.map_err(Into::into)
    }

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
