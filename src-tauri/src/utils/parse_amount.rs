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
		.is_some_and(|part| part.len() > decimals.into())
	{
		return Err(format!(
			"Enter a non-negative amount with at most {decimals} decimal places"
		));
	}

	let parsed = parse_units(&value, decimals)
		.map_err(|_| String::from("Invalid Amount Entered"))?;
	Ok(parsed.into())
}
