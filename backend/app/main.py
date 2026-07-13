from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .core.config import settings
from .routers import health, auth, quotes, pmm

app = FastAPI(title="Anillo Quote Tool API")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(quotes.router)
app.include_router(pmm.router)

@app.get("/")
async def root():
    return {"message": "Anillo Quote Tool API"}
