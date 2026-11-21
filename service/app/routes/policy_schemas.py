"""Cuerpos de petición/respuesta de los endpoints `/policy*` (docs/api-contract.md)."""

from typing import Self

from pydantic import BaseModel, Field, model_validator

from app.authoring.models import EvalSnapshot, FeedbackRef, Preferences
from app.policy import PolicyContent
from app.policy_eval import DEFAULT_CONFIG, ErrorRef


class PolicyOut(BaseModel):
    version: int
    policy_version: str
    content: PolicyContent
    yaml: str
    incorporated: int = 0  # etiquetas marcadas como incorporadas en este guardado (PUT)


class PolicyUpdate(BaseModel):
    """Exactamente uno de `content` (formulario) o `yaml` (modo avanzado)."""

    content: PolicyContent | None = None
    yaml: str | None = None
    expected_version: int | None = None  # 409 si la política cambió mientras se editaba
    # Etiquetas usadas por `POST /policy/refresh`: se marcan incorporadas al guardar.
    incorporate: list[FeedbackRef] = Field(default_factory=list)

    @model_validator(mode="after")
    def _one_source(self) -> Self:
        if (self.content is None) == (self.yaml is None):
            raise ValueError("send exactly one of `content` or `yaml`")
        return self


class DraftIn(BaseModel):
    preferences: Preferences


class EvaluateIn(BaseModel):
    content: PolicyContent
    judge: str | None = None  # por defecto, el más barato con clave configurada
    config: str = DEFAULT_CONFIG
    dry_run: bool = True


class RefineIn(BaseModel):
    draft: PolicyContent
    errors: list[ErrorRef] = Field(min_length=1)
    config: str = DEFAULT_CONFIG
    preferences: Preferences | None = None
    snapshot: EvalSnapshot | None = None


class RefreshIn(BaseModel):
    config: str = DEFAULT_CONFIG  # niveles de la ficha que se resumen para Claude


class EditIn(BaseModel):
    policy: PolicyContent
    instruction: str = Field(min_length=1, max_length=2000)
