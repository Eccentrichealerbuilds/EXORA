pub fn format_price(raw: u64, decimals: u32) -> String {
	if decimals == 0 {
		return raw.to_string();
	}

	let width = decimals as usize + 1;
	let padded = format!("{raw:0>width$}");
	let decimal_point = padded.len() - decimals as usize;
	format!("{}.{}", &padded[..decimal_point], &padded[decimal_point..])
}

pub fn format_decimal_string(raw: &str, decimals: u32) -> String {
    if !raw.bytes().all(|b| b.is_ascii_digit()) || raw.is_empty() {
        return "0".into();
    }
    if decimals == 0 {
        return raw.into();
    }
    let width = decimals as usize + 1;
    let padded = format!("{raw:0>width$}");
    let decimal_point = padded.len() - decimals as usize;
    format!("{}.{}", &padded[..decimal_point], &padded[decimal_point..])
}
