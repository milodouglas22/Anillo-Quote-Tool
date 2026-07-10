from pydantic_settings import BaseSettings
from typing import List, Optional
import os

class Settings(BaseSettings):
    # Azure AD
    AZURE_CLIENT_ID: str = ""
    AZURE_TENANT_ID: str = ""
    ALLOWED_GROUPS: Optional[str] = None

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173"

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    @property
    def allowed_groups_list(self) -> List[str]:
        if not self.ALLOWED_GROUPS:
            return []
        return [g.strip() for g in self.ALLOWED_GROUPS.split(",") if g.strip()]

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
