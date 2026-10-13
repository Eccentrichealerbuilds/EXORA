from dotenv import load_dotenv
from web3 import Web3
import os

load_dotenv()

rpc_url = os.getenv("MONAD_RPC_URL")
if not rpc_url:
    raise ValueError("MONAD_RPC_URL is not set in the environment variables")

AUSD_CONTRACT_ADDRESS = Web3.to_checksum_address(os.getenv("AUSD_CONTRACT_ADDRESS"))
if not AUSD_CONTRACT_ADDRESS:
    raise ValueError("AUSD_CONTRACT_ADDRESS is not set in the environment variables")

w3 = Web3(Web3.HTTPProvider(rpc_url))
if not w3.is_connected():
    raise ConnectionError(f"Failed to connect to the blockchain at {rpc_url}")


AUSD_ABI = [
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "account",
                "type": "address",
            }
        ],
        "name": "balanceOf",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256",
            }
        ],
        "stateMutability": "view",
        "type": "function",
    }
]


ausd_contract = w3.eth.contract(
    address=AUSD_CONTRACT_ADDRESS,
    abi=AUSD_ABI,
)


def get_ausd_balance(address: str) -> int:
    checksum_address = Web3.to_checksum_address(address)

    return ausd_contract.functions.balanceOf(
        checksum_address
    ).call()

