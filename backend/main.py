import os
import secrets

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from database import (
    init_db,
    get_group_settings,
    save_group_settings,
    get_group_count
)

APP_VERSION = "2.1.0"
PANEL_API_KEY = os.getenv("PANEL_API_KEY", "")

ALLOWED_ORIGINS = [
    x.strip()
    for x in os.getenv(
        "ALLOWED_ORIGINS",
        "https://hirad1222.github.io"
    ).split(",")
    if x.strip()
]

app = FastAPI(
    title="HIRAD ROBOT PANEL API",
    version=APP_VERSION
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "PUT", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"]
)

security = HTTPBearer(auto_error=False)

@app.on_event("startup")
def startup():
    init_db()

def require_panel_key(
    credentials: HTTPAuthorizationCredentials =
    Depends(security)
):
    if not PANEL_API_KEY or len(PANEL_API_KEY) < 32:
        raise HTTPException(
            status_code=503,
            detail="Panel authentication is not configured."
        )

    if not credentials:
        raise HTTPException(
            status_code=401,
            detail="Authentication required"
        )

    if not secrets.compare_digest(
        credentials.credentials,
        PANEL_API_KEY
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid panel key"
        )

    return True

class GroupSettings(BaseModel):
    settings: dict = Field(default_factory=dict)

@app.get("/")
def root():
    return {
        "name": "HIRAD ROBOT PANEL",
        "version": APP_VERSION,
        "status": "running"
    }

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "hirad-backend",
        "version": APP_VERSION
    }

@app.get("/api/summary")
def summary(auth=Depends(require_panel_key)):
    return {
        "groups": get_group_count(),
        "violations": 0,
        "messages_checked": 0,
        "rubika_connected": False,
        "integration_status": "not_configured"
    }

@app.get("/api/groups")
def groups(auth=Depends(require_panel_key)):
    return {
        "groups": [],
        "integration_status": "not_configured"
    }

@app.get("/api/groups/{group_id}/settings")
def read_settings(
    group_id: str,
    auth=Depends(require_panel_key)
):
    if not group_id or len(group_id) > 200:
        raise HTTPException(
            status_code=400,
            detail="Invalid group ID"
        )

    return {
        "group_id": group_id,
        "settings": get_group_settings(group_id)
    }

@app.put("/api/groups/{group_id}/settings")
def write_settings(
    group_id: str,
    body: GroupSettings,
    auth=Depends(require_panel_key)
):
    if not group_id or len(group_id) > 200:
        raise HTTPException(
            status_code=400,
            detail="Invalid group ID"
        )

    if len(str(body.settings)) > 30000:
        raise HTTPException(
            status_code=413,
            detail="Settings are too large"
        )

    save_group_settings(group_id, body.settings)

    return {
        "success": True,
        "group_id": group_id,
        "settings": body.settings
    }
