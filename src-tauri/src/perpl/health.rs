//! Display estimates from Perpl's published liquidation-price equation.
//! https://docs.perpl.xyz/exchange/liquidation (2026-10-08).
//! Never used to authorize a transaction or promise an executable removal.
use serde::Serialize;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
	pub liquidation_price: Option<String>,
	pub distance_percent: Option<String>,
	pub effective_leverage: Option<String>,
}
pub fn estimate(
	long: bool,
	entry: f64,
	mark: f64,
	size: f64,
	deposit: f64,
	funding: f64,
	mmf_hundredths: u32,
) -> Health {
	let mut result = Health {
		liquidation_price: None,
		distance_percent: None,
		effective_leverage: None,
	};
	if ![entry, mark, size, deposit, funding]
		.iter()
		.all(|v| v.is_finite())
		|| entry <= 0.0
		|| mark <= 0.0 || size <= 0.0
		|| mmf_hundredths == 0
	{
		return result;
	}
	let side = if long { 1.0 } else { -1.0 };
	let maintenance = entry * size * 100.0 / f64::from(mmf_hundredths);
	let liquidation = entry + side * (maintenance - deposit - funding) / size;
	if liquidation > 0.0 && liquidation.is_finite() {
		result.liquidation_price = Some(format!("{liquidation:.8}"));
		result.distance_percent =
			Some(format!("{:.4}", side * (mark - liquidation) / mark * 100.0));
	}
	let equity = deposit + side * (mark - entry) * size + funding;
	if equity > 0.0 {
		result.effective_leverage = Some(format!("{:.2}", mark * size / equity));
	}
	result
}
#[cfg(test)]
mod tests {
	use super::*;
	#[test]
	fn published_long_example() {
		let h = estimate(true, 100000.0, 100000.0, 1.0, 10000.0, 0.0, 2500);
		assert_eq!(h.liquidation_price.as_deref(), Some("94000.00000000"));
		assert_eq!(h.distance_percent.as_deref(), Some("6.0000"));
	}
	#[test]
	fn funding_and_side_change_the_estimate() {
		assert_eq!(
			estimate(false, 100000.0, 100000.0, 1.0, 10000.0, 1000.0, 2500)
				.liquidation_price
				.as_deref(),
			Some("107000.00000000")
		);
	}
	#[test]
	fn missing_values_stay_unknown() {
		assert!(estimate(true, 0.0, 1.0, 0.0, 0.0, 0.0, 0)
			.liquidation_price
			.is_none());
	}
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginPreviewInput {
	market_id: u32,
	side: String,
	entry: String,
	mark: String,
	size: String,
	deposit: String,
	funding: String,
	mode: String,
	amount: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginPreview {
	pub margin: String,
	pub health: Health,
}
#[tauri::command]
pub async fn preview_margin_change(input: MarginPreviewInput) -> Result<MarginPreview, String> {
	use crate::utils::parse_amount::parse_amount;
	if !["long", "short"].contains(&input.side.as_str()) {
		return Err("Choose a valid position side".into());
	}
	let deposit = parse_amount(Some(input.deposit), 6)?;
	let amount = parse_amount(Some(input.amount), 6)?;
	if amount.is_zero() {
		return Err("Enter an amount above zero".into());
	}
	let after = match input.mode.as_str() {
		"add" => deposit.checked_add(amount).ok_or("Amount is too large")?,
		"remove" => deposit
			.checked_sub(amount)
			.ok_or("Requested removal exceeds deposited margin")?,
		_ => return Err("Choose add or remove".into()),
	};
	let margin = alloy::primitives::utils::format_units(after, 6)
		.map_err(|_| "Could not format margin")?;
	let context = crate::context::market_metadata()
		.await
		.map_err(|_| "Could not load market risk parameters")?;
	let market = context
		.markets
		.get(&input.market_id)
		.ok_or("Market unavailable")?;
	let read = |text: &str| text.parse::<f64>().unwrap_or(f64::NAN);
	let health = estimate(
		input.side == "long",
		read(&input.entry),
		read(&input.mark),
		read(&input.size),
		read(&margin),
		read(&input.funding),
		market.maintenance_margin,
	);
	Ok(MarginPreview { margin, health })
}
#[tauri::command]
pub fn percentage_amount(amount: String, percent: u8) -> Result<String, String> {
	if ![25, 50, 100].contains(&percent) {
		return Err("Choose a supported percentage".into());
	}
	let value = crate::utils::parse_amount::parse_amount(Some(amount), 6)?;
	let fraction = value
		.checked_mul(alloy::primitives::U256::from(percent))
		.ok_or("Amount is too large")?
		/ alloy::primitives::U256::from(100);
	alloy::primitives::utils::format_units(fraction, 6)
		.map_err(|_| "Could not format amount".into())
}
