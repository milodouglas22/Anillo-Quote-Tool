from fastapi import APIRouter, Depends
from ..core.security import get_current_user
from ..models.user import CurrentUser

router = APIRouter(prefix="/auth", tags=["auth"])

@router.get("/verify")
async def verify_access(current_user: CurrentUser = Depends(get_current_user)):
    """Verify user has access to the application."""
    return {
        "status": "authorized",
        "user": {
            "oid": current_user.oid,
            "name": current_user.name,
            "email": current_user.email
        }
    }
