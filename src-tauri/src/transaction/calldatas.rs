use alloy::primitives::{Address, Bytes, U256};
use alloy::sol;
use alloy::sol_types::SolCall;

sol! {
	function transfer(address to, uint256 amount) external returns (bool);
	function balanceOf(address owner) external view returns (uint256);
	function allowance(address owner, address spender) external view returns (uint256);
	function approve(address spender, uint256 amount) external returns (bool);
	function requestFunds(address _receiver) external;
	function faucetDripAmount() external view returns (uint256);
	function maxAmountToOwn() external view returns (uint256);
	function token() external view returns (address);
}

pub fn agora_testnet_address() -> Address {
	"0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC"
		.parse()
		.expect("fixed Agora USD address")
}

pub fn agora_testnet_transfer(to: Address, amount: U256) -> Bytes {
	transferCall { to, amount }.abi_encode().into()
}

pub fn agora_testnet_faucet_address() -> Address {
	"0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C"
		.parse()
		.expect("fixed Agora USD faucet address")
}

pub fn agora_testnet_faucet_request(receiver: Address) -> Bytes {
	requestFundsCall {
		_receiver: receiver,
	}
	.abi_encode()
	.into()
}
