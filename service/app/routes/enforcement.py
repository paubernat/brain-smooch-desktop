"""Ajustes del bloqueo (`/settings/enforcement`) y de la interfaz (`/settings/ui`)."""

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.enforcement import SETTINGS_KEY, EnforcementSettings
from app.lock.classify import enforcement_relaxations
from app.routes.deps import Ctx
from app.settings_store import load_model, save_model

router = APIRouter(prefix="/settings")

UI_KEY = "ui"


class UiSettings(BaseModel):
    """Idioma de la web local; la extensión lo copia para el panel y las pantallas de bloqueo."""

    language: Literal["en", "es", "ca"] | None = None


@router.get("/enforcement", response_model=EnforcementSettings)
async def get_enforcement(ctx: Ctx) -> EnforcementSettings:
    return load_model(ctx.database, SETTINGS_KEY, EnforcementSettings)


@router.put("/enforcement", response_model=EnforcementSettings)
async def put_enforcement(
    body: EnforcementSettings, request: Request, ctx: Ctx
) -> EnforcementSettings:
    current = load_model(ctx.database, SETTINGS_KEY, EnforcementSettings)
    relax = enforcement_relaxations(current, body)
    ctx.lock.authorize(request, relax, kind="enforcement", payload=body.model_dump())
    return save_model(ctx.database, SETTINGS_KEY, body)


@router.get("/ui", response_model=UiSettings)
async def get_ui(ctx: Ctx) -> UiSettings:
    return load_model(ctx.database, UI_KEY, UiSettings)


@router.put("/ui", response_model=UiSettings)
async def put_ui(body: UiSettings, ctx: Ctx) -> UiSettings:
    return save_model(ctx.database, UI_KEY, body)
