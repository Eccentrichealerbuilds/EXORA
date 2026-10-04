use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyCreateRequest {
	pub rp_id: String,
	pub rp_name: String,
	pub user_id: Vec<u8>,
	pub user_name: String,
	pub display_name: String,
	pub challenge: Vec<u8>,
	pub algorithms: Vec<i32>,
	pub prf_salt: Vec<u8>,
	pub resident_key: String,
	pub user_verification: String,
	pub attestation: String,
	pub timeout: Option<u64>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialResponse {
	pub credential_id: Vec<u8>,
	pub prf_enabled: Option<bool>,
	pub prf_output: Option<Vec<u8>>,
	pub transports: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyGetRequest {
	pub rp_id: String,
	pub challenge: Vec<u8>,
	pub credential_id: Option<Vec<u8>>,
	pub transports: Option<Vec<String>>,
	pub prf_salt: Vec<u8>,
	pub user_verification: String,
	pub timeout: Option<u64>,
}
