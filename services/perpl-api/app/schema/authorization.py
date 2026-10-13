from pydantic import BaseModel

class AuthorizationCreate(BaseModel):
    from_address: str
    to_address: str
    amount: str


class AuthorizationResponse(BaseModel):
    id: str
    from_address: str
    to_address: str
    value: int
    valid_after: int
    valid_before: int
    nonce: str
    status: str