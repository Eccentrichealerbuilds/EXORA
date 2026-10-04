use std::{io, net::SocketAddr, time::Duration};

use tokio::{net::TcpStream, task::JoinSet};
use tokio_tungstenite::{
    client_async_tls_with_config,
    tungstenite::{client::IntoClientRequest, handshake::client::Response},
    MaybeTlsStream, WebSocketStream,
};

use crate::AppError;

// A mobile network can advertise IPv6 while silently dropping its traffic.
// Tokio's sequential address attempts then exhaust the entire connection timeout
// before reaching working IPv4 addresses. Start fallback attempts without waiting
// for the first address to time out, and cancel the remaining attempts on success.
async fn connect_addresses(addresses: Vec<SocketAddr>) -> io::Result<TcpStream> {
    let mut attempts = JoinSet::new();
    for (index, address) in addresses.into_iter().enumerate() {
        attempts.spawn(async move {
            tokio::time::sleep(Duration::from_millis(250 * index as u64)).await;
            tokio::time::timeout(Duration::from_secs(8), TcpStream::connect(address))
                .await
                .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "Market connection timed out"))?
        });
    }
    let mut last_error = io::Error::new(io::ErrorKind::NotFound, "No market server addresses found");
    while let Some(result) = attempts.join_next().await {
        match result {
            Ok(Ok(stream)) => {
                attempts.abort_all();
                stream.set_nodelay(true)?;
                return Ok(stream);
            }
            Ok(Err(error)) => last_error = error,
            Err(error) => last_error = io::Error::other(error),
        }
    }
    Err(last_error)
}

pub async fn connect(url: &str) -> Result<(WebSocketStream<MaybeTlsStream<TcpStream>>, Response), AppError> {
    let request = url.into_client_request()?;
    let host = request.uri().host().ok_or("Market server has no hostname")?;
    let port = request.uri().port_u16().unwrap_or(443);
    let addresses = tokio::net::lookup_host((host, port)).await?.collect();
    let stream = connect_addresses(addresses).await?;
    // Retain the original hostname for certificate verification and TLS SNI.
    Ok(client_async_tls_with_config(request, stream, None, None).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn connects_to_an_alternative_address() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let unused = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let unavailable = unused.local_addr().unwrap();
        drop(unused);
        let stream = connect_addresses(vec![unavailable, listener.local_addr().unwrap()]).await.unwrap();
        assert_eq!(stream.peer_addr().unwrap(), listener.local_addr().unwrap());
    }

    #[tokio::test]
    async fn missing_addresses_return_an_error() {
        assert_eq!(connect_addresses(vec![]).await.unwrap_err().kind(), io::ErrorKind::NotFound);
    }
}
