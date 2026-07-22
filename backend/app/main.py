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

@app.on_event("startup")
async def _warm_engines():
    """Load the pricing + PMM data in the background at startup so the first user request
    (customer suggest / part context) doesn't block ~60s on the cold workbook load."""
    import threading
    from .services.contract_pricing import engine as pricing
    from .services.pmm_pricing import engine as pmm

    def _load():
        try:
            pricing.ensure_loaded()
            pmm.ensure_loaded()
        except Exception:
            pass
    threading.Thread(target=_load, daemon=True).start()


@app.get("/")
async def root():
    return {"message": "Anillo Quote Tool API"}
