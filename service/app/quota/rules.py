"""Reglas del cupo diario de LIMITADO (PLAN-FASE2 §5). Puras: sin base de datos ni reloj.

- Cupo diario (`daily_s`, 30 min por defecto) de tiempo reproducido de vídeos LIMITADO.
- Gracia: si al agotarse el cupo al vídeo que se está viendo le quedan menos de 10 min, se
  conceden 10 min más para terminarlo (solo a ese vídeo, una vez al día).
- Vídeos largos (≥ 1 h): al agotarse el cupo se guarda la posición y se retoma al día
  siguiente (`resume_tomorrow`).
- Cualquier otro vídeo LIMITADO con el cupo agotado: `exhausted`.

La gracia solo se concede en el latido que agota el cupo (el vídeo que se estaba viendo en
ese momento); abrir otro vídeo con el cupo ya agotado no da gracia.
"""

from dataclasses import dataclass, replace
from typing import Literal

from pydantic import BaseModel, Field

GRACE_S = 600.0
GRACE_IF_REMAINING_S = 600.0
LONG_VIDEO_S = 3600.0
# Un latido nunca cuenta más que esto (cada ~15 s; tolera retrasos del navegador).
MAX_HEARTBEAT_S = 30.0

QuotaState = Literal["ok", "grace", "exhausted", "resume_tomorrow"]


class QuotaSettings(BaseModel):
    """Ajuste editable (`/settings/quota`). Subirlo es relajar."""

    daily_minutes: int = Field(default=30, ge=0, le=24 * 60)

    @property
    def daily_s(self) -> float:
        return self.daily_minutes * 60.0


@dataclass(frozen=True)
class DayUsage:
    """Consumo de un día local."""

    used_s: float = 0.0
    grace_video: str | None = None
    grace_used_s: float = 0.0


@dataclass(frozen=True)
class VideoProgress:
    video_id: str
    duration_s: float | None = None
    position_s: float | None = None

    @property
    def remaining_s(self) -> float | None:
        if self.duration_s is None or self.position_s is None:
            return None
        return max(0.0, self.duration_s - self.position_s)

    @property
    def is_long(self) -> bool:
        return self.duration_s is not None and self.duration_s >= LONG_VIDEO_S


class VideoQuota(BaseModel):
    """Qué puede hacer el vídeo con el cupo de hoy."""

    allowed: bool
    state: QuotaState
    grace_remaining_s: float = 0.0
    # Posición a la que saltar (vídeo largo cortado un día anterior) o que se guarda hoy.
    resume_at_s: float | None = None


def remaining_s(usage: DayUsage, daily_s: float) -> float:
    return max(0.0, daily_s - usage.used_s)


def check(usage: DayUsage, daily_s: float, video: VideoProgress) -> VideoQuota:
    """Estado del vídeo sin sumar tiempo (al abrirlo o al consultarlo)."""
    if usage.used_s < daily_s:
        return VideoQuota(allowed=True, state="ok")
    if usage.grace_video == video.video_id and usage.grace_used_s < GRACE_S:
        return VideoQuota(
            allowed=True, state="grace", grace_remaining_s=GRACE_S - usage.grace_used_s
        )
    if video.is_long:
        return VideoQuota(allowed=False, state="resume_tomorrow", resume_at_s=video.position_s)
    return VideoQuota(allowed=False, state="exhausted")


def heartbeat(
    usage: DayUsage, daily_s: float, video: VideoProgress, seconds: float
) -> tuple[DayUsage, VideoQuota]:
    """Suma `seconds` reproducidos de `video` y devuelve el consumo nuevo y su estado."""
    seconds = min(max(0.0, seconds), MAX_HEARTBEAT_S)
    before = usage.used_s
    counted = min(seconds, max(0.0, daily_s - before))
    usage = replace(usage, used_s=before + counted)
    overflow = seconds - counted
    if usage.used_s < daily_s:
        return usage, VideoQuota(allowed=True, state="ok")
    if usage.grace_video == video.video_id:
        usage = replace(usage, grace_used_s=usage.grace_used_s + overflow)
    elif usage.grace_video is None and before < daily_s and _grace_eligible(video):
        # Este latido agota el cupo y al vídeo le queda poco: gracia para terminarlo.
        usage = replace(usage, grace_video=video.video_id, grace_used_s=overflow)
    return usage, check(usage, daily_s, video)


def _grace_eligible(video: VideoProgress) -> bool:
    left = video.remaining_s
    return left is not None and left < GRACE_IF_REMAINING_S
