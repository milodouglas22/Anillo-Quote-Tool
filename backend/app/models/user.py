from pydantic import BaseModel
from typing import List, Optional

class CurrentUser(BaseModel):
    oid: str
    name: str
    email: str
    groups: List[str] = []

    @property
    def username(self) -> str:
        return self.email or self.name or self.oid
