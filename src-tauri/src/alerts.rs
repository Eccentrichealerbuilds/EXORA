//! Local, one-shot price alerts. The monitoring service is required after Android suspends the app.
use alloy::primitives::U256;
use serde::{Deserialize, Serialize};
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
static FOREGROUND: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);
#[tauri::command]
pub fn set_alert_visibility(visible: bool) {
	FOREGROUND.store(visible, std::sync::atomic::Ordering::Relaxed);
}
static ACTIVE: LazyLock<Mutex<Option<(String, Vec<PriceAlert>)>>> =
	LazyLock::new(|| Mutex::new(None));
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceAlert {
	pub id: String,
	pub market_id: u32,
	pub symbol: String,
	pub watch: String,
	pub direction: String,
	pub target_price: String,
	pub triggered: bool,
	#[serde(default)]
	pub remote: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertInput {
	pub market_id: u32,
	pub watch: String,
	pub direction: String,
	pub target_price: String,
}
fn key(address: &str) -> Result<String, String> {
	Ok(format!(
		"alerts-{}",
		crate::local_data::wallet_key(address)?
	))
}
#[tauri::command]
pub fn activate_alerts(app: AppHandle, address: Option<String>) -> Result<Vec<PriceAlert>, String> {
	let mut active = ACTIVE.lock().map_err(|_| "Alerts are unavailable")?;
	if let Ok(mut warned) = WARNED.lock() {
		warned.clear();
	}
	if let Some(address) = address {
		let key = key(&address)?;
		let mut alerts: Vec<PriceAlert> =
			crate::local_data::read(&app, &key).unwrap_or_default();
		if !crate::remote_alerts::connected_for(&app, &address) {
			for alert in &mut alerts {
				alert.remote = false;
			}
		}
		*active = Some((key, alerts));
	} else {
		*active = None;
	}
	Ok(active
		.as_ref()
		.map(|(_, items)| items.clone())
		.unwrap_or_default())
}
#[tauri::command]
pub async fn create_price_alert(
	app: AppHandle,
	address: String,
	input: AlertInput,
) -> Result<Vec<PriceAlert>, String> {
	if !["above", "below"].contains(&input.direction.as_str())
		|| !["mark", "last"].contains(&input.watch.as_str())
	{
		return Err("Choose a supported alert condition".into());
	}
	let context = crate::context::market_metadata()
		.await
		.map_err(|_| "Could not load alert markets")?;
	let market = context
		.markets
		.get(&input.market_id)
		.ok_or("This market is unavailable")?;
	let amount = crate::utils::parse_amount::parse_amount(
		Some(input.target_price.clone()),
		market.price_decimals as u8,
	)
	.map_err(|_| "Enter a valid target price for this market")?;
	if amount.is_zero() {
		return Err("Enter a target price above zero".into());
	}
	let key = key(&address)?;
	let mut active = ACTIVE.lock().map_err(|_| "Alerts are unavailable")?;
	let (active_key, items) = active
		.as_mut()
		.filter(|(k, _)| k == &key)
		.ok_or("Sign in again to enable alerts")?;
	if items.len() >= 50 {
		return Err("Remove an old alert before adding another (50 maximum)".into());
	}
	let mut next = items.clone();
	next.push(PriceAlert {
		id: alloy::primitives::hex::encode(rand::random::<[u8; 16]>()),
		market_id: input.market_id,
		symbol: market.symbol.clone(),
		watch: input.watch,
		direction: input.direction,
		target_price: input.target_price,
		triggered: false,
		remote: false,
	});
	crate::local_data::write(&app, active_key, &next)?;
	*items = next;
	Ok(items.clone())
}
#[tauri::command]
pub fn remove_price_alert(
	app: AppHandle,
	address: String,
	id: String,
) -> Result<Vec<PriceAlert>, String> {
	let key = key(&address)?;
	let mut active = ACTIVE.lock().map_err(|_| "Alerts are unavailable")?;
	let (active_key, items) = active
		.as_mut()
		.filter(|(k, _)| k == &key)
		.ok_or("Sign in again to manage alerts")?;
	let next: Vec<_> = items.iter().filter(|item| item.id != id).cloned().collect();
	crate::local_data::write(&app, active_key, &next)?;
	*items = next;
	Ok(items.clone())
}
#[tauri::command]
pub fn list_price_alerts(app: AppHandle, address: String) -> Result<Vec<PriceAlert>, String> {
	saved_alerts(&app, &address)
}
pub fn accept_remote_alert(app: &AppHandle, id: &str) -> bool {
	let Ok(mut active) = ACTIVE.lock() else {
		return false;
	};
	let Some((key, items)) = active.as_mut() else {
		return false;
	};
	let Some(alert) = items.iter_mut().find(|a| a.id == id) else {
		return false;
	};
	if alert.triggered {
		return false;
	}
	alert.triggered = true;
	let _ = crate::local_data::write(app, key, items);
	let _ = app.emit("exora-alerts-synced", ());
	true
}
pub fn saved_alerts(app: &AppHandle, address: &str) -> Result<Vec<PriceAlert>, String> {
	Ok(crate::local_data::read(app, &key(address)?).unwrap_or_default())
}
pub fn set_remote_state(
	app: &AppHandle,
	address: &str,
	remote_ids: &[String],
	triggered: &[String],
) -> Result<Vec<PriceAlert>, String> {
	let key = key(address)?;
	let mut active = ACTIVE.lock().map_err(|_| "Alerts are unavailable")?;
	let mut items: Vec<PriceAlert> = crate::local_data::read(app, &key).unwrap_or_default();
	let connected = crate::remote_alerts::connected_for(app, address);
	for item in &mut items {
		item.remote = connected && remote_ids.contains(&item.id);
		item.triggered |= triggered.contains(&item.id);
	}
	crate::local_data::write(app, &key, &items)?;
	if let Some((active_key, current)) = active.as_mut() {
		if active_key == &key {
			*current = items.clone();
		}
	}
	let _ = app.emit("exora-alerts-synced", ());
	Ok(items)
}
fn matches(price: U256, target: U256, direction: &str) -> bool {
	if direction == "above" {
		price >= target
	} else {
		price <= target
	}
}
pub fn evaluate(app: &AppHandle, market: &crate::context::MarketInfo) {
	let Ok(mut active) = ACTIVE.lock() else {
		return;
	};
	let Some((key, items)) = active.as_mut() else {
		return;
	};
	let mut next = items.clone();
	let mut fired = Vec::new();
	for alert in next
		.iter_mut()
		.filter(|item| !item.triggered && !item.remote && item.market_id == market.id)
	{
		let price = if alert.watch == "mark" {
			market.mark_price.as_deref()
		} else {
			market.price.as_deref()
		};
		let parse = |s: &str| {
			crate::utils::parse_amount::parse_amount(
				Some(s.to_string()),
				market.price_decimals as u8,
			)
			.ok()
		};
		let (Some(price), Some(target)) =
			(price.and_then(parse), parse(&alert.target_price))
		else {
			continue;
		};
		if !price.is_zero() && matches(price, target, &alert.direction) {
			alert.triggered = true;
			fired.push(alert.clone());
		}
	}
	if fired.is_empty() || crate::local_data::write(app, key, &next).is_err() {
		return;
	}
	*items = next;
	drop(active);
	for alert in fired {
		let message = format!(
			"{} {} price is {} {} USD",
			alert.symbol, alert.watch, alert.direction, alert.target_price
		);
		let _ = app.emit("exora-price-alert", &alert);
		// The platform refuses notifications without permission; no prompt is triggered here.
		if !FOREGROUND.load(std::sync::atomic::Ordering::Relaxed) {
			let _ = app
				.notification()
				.builder()
				.title("EXORA price alert")
				.body(message)
				.show();
		}
	}
}
#[cfg(test)]
mod tests {
	use super::*;
	#[test]
	fn conditions_include_the_exact_boundary() {
		assert!(matches(U256::from(100), U256::from(100), "above"));
		assert!(matches(U256::from(100), U256::from(100), "below"));
		assert!(!matches(U256::from(99), U256::from(100), "above"));
		assert!(!matches(U256::from(101), U256::from(100), "below"));
	}
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AlertPreferences {
	pub order_fills: bool,
	pub sl_tp_updates: bool,
	pub liquidation_threshold: String,
}
impl Default for AlertPreferences {
	fn default() -> Self {
		Self {
			order_fills: true,
			sl_tp_updates: true,
			liquidation_threshold: "off".into(),
		}
	}
}
#[tauri::command]
pub fn get_alert_preferences(app: AppHandle, address: String) -> Result<AlertPreferences, String> {
	Ok(crate::local_data::read(
		&app,
		&format!(
			"alert-preferences-{}",
			crate::local_data::wallet_key(&address)?
		),
	)
	.unwrap_or_default())
}
#[tauri::command]
pub fn save_alert_preferences(
	app: AppHandle,
	address: String,
	preferences: AlertPreferences,
) -> Result<(), String> {
	if !["off", "2", "5", "10"].contains(&preferences.liquidation_threshold.as_str()) {
		return Err("Choose a supported warning threshold".into());
	}
	crate::local_data::write(
		&app,
		&format!(
			"alert-preferences-{}",
			crate::local_data::wallet_key(&address)?
		),
		&preferences,
	)?;
	if let Ok(mut warned) = WARNED.lock() {
		warned.clear();
	}
	Ok(())
}
pub fn account_notice(app: &AppHandle, address: &str, category: &str, message: &str) {
	if crate::remote_alerts::account_connected(app, address) {
		return;
	}
	let Ok(key) = key(address) else { return };
	if !ACTIVE
		.lock()
		.ok()
		.is_some_and(|active| active.as_ref().is_some_and(|(k, _)| k == &key))
	{
		return;
	}
	let Ok(preferences) = get_alert_preferences(app.clone(), address.to_string()) else {
		return;
	};
	if (category == "fill" && !preferences.order_fills)
		|| (category == "protection" && !preferences.sl_tp_updates)
	{
		return;
	}
	let _ = app.emit(
		"exora-account-alert",
		serde_json::json!({"message":message}),
	);
	if !FOREGROUND.load(std::sync::atomic::Ordering::Relaxed) {
		let _ = app
			.notification()
			.builder()
			.title("EXORA account update")
			.body(message)
			.show();
	}
}
static WARNED: LazyLock<Mutex<std::collections::HashSet<String>>> =
	LazyLock::new(|| Mutex::new(std::collections::HashSet::new()));
pub fn position_health(app: &AppHandle, account: &crate::perpl::account::AccountView) {
	let Ok(active_key) = key(&account.address) else {
		return;
	};
	let Ok(active) = ACTIVE.lock() else { return };
	if !active.as_ref().is_some_and(|(k, _)| k == &active_key) {
		return;
	}
	// Clear closed positions so a later position in the same market can warn again.
	if let Ok(mut warned) = WARNED.lock() {
		warned.retain(|key| {
			account.positions
				.iter()
				.any(|p| key == &format!("{}:{}", account.address, p.market_id))
		});
	}
	drop(active);
	let Ok(preferences) = get_alert_preferences(app.clone(), account.address.clone()) else {
		return;
	};
	let Ok(threshold) = preferences.liquidation_threshold.parse::<f64>() else {
		return;
	};
	for position in &account.positions {
		let Some(distance) = position
			.health
			.distance_percent
			.as_deref()
			.and_then(|s| s.parse::<f64>().ok())
		else {
			continue;
		};
		let key = format!("{}:{}", account.address, position.market_id);
		let Ok(mut warned) = WARNED.lock() else {
			return;
		};
		if distance > threshold + 1.0 {
			warned.remove(&key);
			continue;
		}
		if distance <= threshold && warned.insert(key) {
			drop(warned);
			account_notice(app,&account.address,"health",&format!("{} is within your estimated liquidation-distance threshold. Review the position.",position.symbol));
		}
	}
}
