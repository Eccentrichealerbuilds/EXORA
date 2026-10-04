use crate::transaction::build_transaction::RPC;
use alloy::providers::{Provider, ProviderBuilder, RootProvider};
use std::{sync::LazyLock, time::Duration};
static PROVIDER: LazyLock<RootProvider> = LazyLock::new(|| {
	use alloy::transports::http::reqwest;

	let roots = webpki_root_certs::TLS_SERVER_ROOT_CERTS
		.iter()
		.map(|certificate| {
			reqwest::Certificate::from_der(certificate.as_ref())
				.expect("bundled Mozilla root certificate")
		});

	let client = reqwest::Client::builder()
		.tls_certs_only(roots)
		.timeout(Duration::from_secs(15))
		.build()
		.expect("valid TLS client configuration");

	let provider = ProviderBuilder::new()
		.disable_recommended_fillers()
		.connect_reqwest(client, RPC.parse().expect("fixed RPC URL"));
	provider.client().set_poll_interval(Duration::from_secs(1));
	provider
});

pub fn provider() -> RootProvider {
	PROVIDER.clone()
}
