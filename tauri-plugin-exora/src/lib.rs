use tauri::{
	plugin::{Builder, TauriPlugin},
	Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(mobile)]
use mobile::Exora;
#[cfg(desktop)]
use desktop::Exora;

pub trait ExoraExt<R: Runtime> {
	fn exora(&self) -> &Exora<R>;
}

impl<R: Runtime, T: Manager<R>> crate::ExoraExt<R> for T {
	fn exora(&self) -> &Exora<R> {
		self.state::<Exora<R>>().inner()
	}
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
	Builder::new("exora")
		.invoke_handler(tauri::generate_handler![
			commands::create_passkey,
			commands::get_credential,
            commands::set_chart_fullscreen
		])
		.setup(|app, api| {
			#[cfg(mobile)]
			let exora = mobile::init(app, api)?;
			#[cfg(desktop)]
			let exora = desktop::init(app, api)?;
			app.manage(exora);
			Ok(())
		})
		.build()
}
