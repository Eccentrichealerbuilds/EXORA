//! Official Portfolio shape: https://docs.perpl.xyz/types#portfolio (2026-10-08).
use super::read_key;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
	pub time: u64,
	pub value: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Performance {
	pub equity: Vec<Point>,
	pub pnl: Vec<Point>,
	pub updated_at: u64,
	pub cached: bool,
}
async fn series(
	app: &AppHandle,
	address: &str,
	kind: &str,
	period: &str,
) -> Result<(Vec<Point>, u64), String> {
	let value = read_key::signed_get(
		app,
		address,
		&format!("/v1/trading/portfolio/{kind}/{period}"),
	)
	.await?;
	let data = value["chart"]
		.as_array()
		.ok_or("Performance data is temporarily unavailable")?;
	let points = data
		.iter()
		.map(|v| {
			Ok(Point {
				time: v["t"].as_u64().ok_or("Invalid performance timestamp")?,
				value: super::activity::scaled(&v["v"], 6)
					.ok_or("Invalid performance amount")?,
			})
		})
		.collect::<Result<Vec<_>, String>>()?;
	Ok((points, value["at"]["t"].as_u64().unwrap_or_default()))
}
#[tauri::command]
pub async fn get_perpl_performance(
	app: AppHandle,
	address: String,
	period: String,
) -> Result<Performance, String> {
	if !["all", "day", "week", "2weeks", "month"].contains(&period.as_str()) {
		return Err("Choose a supported performance period".into());
	}
	let key = format!(
		"cache-performance-{}-{period}",
		crate::local_data::wallet_key(&address)?
	);
	let result = tokio::try_join!(
		series(&app, &address, "equity", &period),
		series(&app, &address, "pnl", &period)
	);
	match result {
		Ok(((equity, t), (pnl, u))) => {
			let result = Performance {
				equity,
				pnl,
				updated_at: t.max(u),
				cached: false,
			};
			let _ = crate::local_data::write(&app, &key, &result);
			Ok(result)
		}
		Err(error) => match crate::local_data::read::<Performance>(&app, &key) {
			Some(mut result) => {
				result.cached = true;
				Ok(result)
			}
			None => Err(error),
		},
	}
}
