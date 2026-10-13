//! Exact integer sizing for a draft; execution still goes through order::prepare.
use crate::utils::parse_amount::parse_amount;
use alloy::primitives::{utils::format_units, U256};
use serde::{Deserialize, Serialize};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanInput {
	pub market_id: u32,
	pub side: String,
	pub sizing: String,
	pub amount: String,
	pub entry: String,
	pub stop: String,
	pub target: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
	pub quantity: String,
	pub size_usd: String,
	pub loss: String,
	pub gain: Option<String>,
	pub reward_risk: Option<String>,
}
fn mul(a: U256, b: U256) -> Result<U256, String> {
	a.checked_mul(b)
		.ok_or_else(|| "Plan amount is too large".into())
}
fn scale(d: u32) -> Result<U256, String> {
	if d > 18 {
		return Err("Unsupported market precision".into());
	}
	Ok(U256::from(10).pow(U256::from(d)))
}
fn formatted(v: U256, d: u32) -> Result<String, String> {
	format_units(v, d as u8).map_err(|_| "Could not format the plan".into())
}
fn calculate(input: &PlanInput, price_decimals: u32, size_decimals: u32) -> Result<Plan, String> {
	if !["long", "short"].contains(&input.side.as_str())
		|| !["usd", "risk"].contains(&input.sizing.as_str())
	{
		return Err("Choose a trade side and sizing method".into());
	}
	let p = scale(price_decimals)?;
	let q = scale(size_decimals)?;
	let usd = scale(6)?;
	let entry = parse_amount(Some(input.entry.clone()), price_decimals as u8)?;
	let stop = parse_amount(Some(input.stop.clone()), price_decimals as u8)?;
	let amount = parse_amount(Some(input.amount.clone()), 6)?;
	if entry.is_zero() || stop.is_zero() || amount.is_zero() {
		return Err("Entry, stop and amount must be above zero".into());
	}
	let long = input.side == "long";
	if (long && stop >= entry) || (!long && stop <= entry) {
		return Err("Place a long stop below entry, or a short stop above entry".into());
	}
	let distance = if long { entry - stop } else { stop - entry };
	let divisor = mul(
		if input.sizing == "risk" {
			distance
		} else {
			entry
		},
		usd,
	)?;
	let quantity = mul(mul(amount, p)?, q)? / divisor;
	if quantity.is_zero() {
		return Err("This plan is smaller than one market lot".into());
	}
	let denom = mul(p, q)?;
	let notional = mul(mul(quantity, entry)?, usd)? / denom;
	let loss = mul(mul(quantity, distance)?, usd)? / denom;
	let gain = match input.target.as_deref().filter(|s| !s.is_empty()) {
		Some(target) => {
			let target = parse_amount(Some(target.into()), price_decimals as u8)?;
			if (long && target <= entry) || (!long && target >= entry) {
				return Err("Place a long target above entry, or a short target below entry".into());
			}
			Some(mul(
				mul(quantity, if long { target - entry } else { entry - target })?,
				usd,
			)? / denom)
		}
		None => None,
	};
	Ok(Plan {
		quantity: formatted(quantity, size_decimals)?,
		size_usd: formatted(notional, 6)?,
		loss: formatted(loss, 6)?,
		gain: gain.map(|v| formatted(v, 6)).transpose()?,
		reward_risk: gain
			.filter(|_| !loss.is_zero())
			.map(|v| formatted(mul(v, U256::from(100))? / loss, 2))
			.transpose()?,
	})
}
#[tauri::command]
pub async fn preview_trade_plan(input: PlanInput) -> Result<Plan, String> {
	let context = crate::context::market_metadata()
		.await
		.map_err(|_| "Market details are unavailable. Reconnect before planning")?;
	let market = context
		.markets
		.get(&input.market_id)
		.ok_or("This market is unavailable")?;
	calculate(&input, market.price_decimals, market.size_decimals)
}
#[cfg(test)]
mod tests {
	use super::*;
	fn input() -> PlanInput {
		PlanInput {
			market_id: 16,
			side: "long".into(),
			sizing: "risk".into(),
			amount: "5".into(),
			entry: "100".into(),
			stop: "90".into(),
			target: Some("120".into()),
		}
	}
	#[test]
	fn risk_sizes_in_base_lots() {
		let p = calculate(&input(), 2, 3).unwrap();
		assert_eq!(p.quantity, "0.500");
		assert_eq!(p.size_usd, "50.000000");
		assert_eq!(p.loss, "5.000000");
		assert_eq!(p.gain.as_deref(), Some("10.000000"));
	}
	#[test]
	fn rounds_down_without_exceeding_planned_risk() {
		let mut i = input();
		i.stop = "93".into();
		let p = calculate(&i, 2, 3).unwrap();
		assert_eq!(p.quantity, "0.714");
		assert_eq!(p.loss, "4.998000");
	}
	#[test]
	fn stop_must_be_on_loss_side() {
		let mut i = input();
		i.stop = "101".into();
		assert!(calculate(&i, 2, 3).is_err());
		i.side = "short".into();
		i.target = None;
		assert!(calculate(&i, 2, 3).is_ok());
	}
}
