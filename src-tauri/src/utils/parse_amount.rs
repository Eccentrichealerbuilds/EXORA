use alloy::primitives::{utils::parse_units, U256};
pub fn parse_amount(value: Option<String>, decimals: u8) -> Result<U256, String> {
	if value == None {
		return Ok(U256::ZERO);
	}
	let value = value.unwrap();
	let pieces: Vec<_> = value.split('.').collect();

	if pieces.is_empty()
		|| pieces.len() > 2
		|| pieces[0].is_empty()
		|| !pieces.iter().all(|part| {
			!part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit())
		}) || pieces
		.get(1)
		.is_some_and(|part| part.trim_end_matches('0').len() > decimals.into())
	{
		return Err(format!(
			"Enter a non-negative amount with at most {decimals} decimal places"
		));
	}

	// Alloy formats zero-decimal values with a `.0` suffix. Remove only
	// insignificant zeros; never round or truncate a real fractional amount.
	let normalized = match pieces.get(1).map(|part| part.trim_end_matches('0')) {
		Some("") | None => pieces[0].to_string(),
		Some(fraction) => format!("{}.{fraction}", pieces[0]),
	};
	let parsed = parse_units(&normalized, decimals)
		.map_err(|_| String::from("Invalid Amount Entered"))?;
	Ok(parsed.into())
}

#[cfg(test)]
mod tests {
	use super::*;
	use alloy::primitives::utils::format_units;

	#[test]
	fn formatted_market_amounts_round_trip_including_whole_token_markets() {
		for decimals in [0u8, 1, 2, 6, 8, 18] {
			for raw in [U256::ZERO, U256::from(1), U256::from(100_000), U256::MAX] {
				let formatted = format_units(raw, decimals).unwrap();
				assert_eq!(parse_amount(Some(formatted), decimals).unwrap(), raw);
			}
		}
	}

	#[test]
	fn redundant_zeros_are_valid_but_real_excess_precision_is_rejected() {
		assert_eq!(parse_amount(Some("1000.000".into()), 0).unwrap(), U256::from(1000));
		assert_eq!(parse_amount(Some("1.2300".into()), 2).unwrap(), U256::from(123));
		assert!(parse_amount(Some("1000.1".into()), 0).is_err());
		assert!(parse_amount(Some("1.2301".into()), 2).is_err());
		for invalid in ["-1", "1e3", ".0", "1.", "1..0", "", "1.0x"] {
			assert!(parse_amount(Some(invalid.into()), 0).is_err());
		}
	}
}
