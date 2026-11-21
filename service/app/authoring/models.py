"""Modelos de entrada/salida del editor agéntico de la política."""

from typing import Any

from pydantic import BaseModel, Field

from app.models import Label
from app.policy import PolicyContent


class TierTexts(BaseModel):
    """Texto libre por nivel (en el orden de la UI: LIBRE, LIMITADO, NO)."""

    libre: str = ""
    limitado: str = ""
    no: str = ""

    def is_empty(self) -> bool:
        return not (self.libre.strip() or self.limitado.strip() or self.no.strip())


class Preferences(TierTexts):
    """Lo que el usuario escribe en el paso 1 del asistente."""

    examples: TierTexts = Field(default_factory=TierTexts)  # títulos o URLs de ejemplo


class AuthorUsage(BaseModel):
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None


class DraftResult(BaseModel):
    content: PolicyContent
    rationale: str
    usage: AuthorUsage


class RefineResult(DraftResult):
    changelog: list[str] = Field(default_factory=list)


class ErrorExample(BaseModel):
    """Vídeo del split dev mal clasificado, resumido para el prompt."""

    video_id: str
    truth: Label
    predicted: Label
    confidence: float
    summary: dict[str, Any]


class EvalSnapshot(BaseModel):
    """Métricas del borrador que se quiere mejorar (contexto para Claude)."""

    n: int
    accuracy: float
    false_libre: int


class FeedbackRef(BaseModel):
    """Una etiqueta concreta (re-etiquetar cambia `labeled_at`)."""

    video_id: str
    labeled_at: str


class FeedbackExample(FeedbackRef):
    """Etiqueta del split dev pendiente de incorporar, con la ficha resumida y el motivo."""

    label: Label
    reason: str | None = None
    summary: dict[str, Any]


class RefreshResult(RefineResult):
    """Propuesta de política a partir de las etiquetas pendientes (sin guardar)."""

    base_version: int
    feedback: list[FeedbackRef] = Field(default_factory=list)  # lo que se marcará al guardar


class EditResult(BaseModel):
    """Política editada según una instrucción del usuario (sin guardar)."""

    content: PolicyContent
    changelog: str
    usage: AuthorUsage
