"""Modelos pydantic del contrato extensión ↔ servicio (docs/api-contract.md) y de los jueces.

- Entrada: `FichaIn`, `LabelIn`.
- Salida: `FichaOut` (ficha almacenada + estado de niveles), `LabelOut`, `Stats`.
- Jueces (PLAN §9): `FichaView` (ficha filtrada por niveles) y `Verdict`.
"""

import json
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


class Label(StrEnum):
    NO = "NO"
    LIMITADO = "LIMITADO"
    LIBRE = "LIBRE"


class InfoLevel(StrEnum):
    """Niveles de información de la ficha (PLAN §3)."""

    L0 = "L0"  # historial de veredictos del canal
    L1 = "L1"  # metadatos
    L2 = "L2"  # canal (YouTube Data API)
    L3 = "L3"  # transcripción
    L4 = "L4"  # visual


ALL_LEVELS: frozenset[InfoLevel] = frozenset(InfoLevel)

TranscriptStatus = Literal["ok", "none", "blocked"]
ChannelStatus = Literal["ok", "pending", "error"]
FramesStatus = Literal["ok", "pending", "none", "error"]
Split = Literal["dev", "test"]


# --- Entrada: POST /fichas -------------------------------------------------------------------


class Chapter(BaseModel):
    start_s: float
    title: str


class MetadataIn(BaseModel):
    title: str
    description_raw: str = ""
    keywords: list[str] = Field(default_factory=list)
    category: str | None = None
    duration_s: int | None = None
    is_short: bool = False
    chapters: list[Chapter] = Field(default_factory=list)
    channel_id: str | None = None
    channel_name: str | None = None
    publish_date: str | None = None
    is_family_safe: bool | None = None
    game: str | None = None


class TranscriptSegment(BaseModel):
    start_s: float
    text: str


class TranscriptIn(BaseModel):
    status: TranscriptStatus = "none"
    language: str | None = None
    kind: str | None = None  # "manual" | "asr"
    segments: list[TranscriptSegment] = Field(default_factory=list)


class StoryboardLevel(BaseModel):
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    frame_count: int = Field(gt=0)
    columns: int = Field(gt=0)
    rows: int = Field(gt=0)
    interval_ms: int = 0


class StoryboardIn(BaseModel):
    thumbnail_url: str | None = None
    level: StoryboardLevel
    sprite_urls: list[str] = Field(default_factory=list)


class FichaIn(BaseModel):
    video_id: str = Field(min_length=1)
    url: str | None = None
    metadata: MetadataIn
    transcript: TranscriptIn = Field(default_factory=TranscriptIn)
    storyboard: StoryboardIn | None = None


# --- Salida: GET /fichas/{video_id} ------------------------------------------------------------


class Levels(BaseModel):
    L1: Literal["ok"] = "ok"
    L2: ChannelStatus = "pending"
    L3: TranscriptStatus = "none"
    L4: FramesStatus = "pending"


class LabelInfo(BaseModel):
    label: Label
    reason: str | None = None
    labeled_at: str


class MetadataOut(MetadataIn):
    description_clean: str = ""


class TranscriptOut(BaseModel):
    status: TranscriptStatus
    language: str | None = None
    kind: str | None = None
    segment_count: int = 0
    excerpt: str = ""


class ChannelInfo(BaseModel):
    channel_id: str
    title: str | None = None
    description: str = ""
    topics: list[str] = Field(default_factory=list)
    keywords: str = ""
    fetched_at: str | None = None


class FrameInfo(BaseModel):
    kind: Literal["thumbnail", "frame"]
    idx: int
    t_s: float | None = None
    path: str  # relativo a `data_dir`


class FichaOut(BaseModel):
    """Ficha completa tal y como está almacenada (respuesta de POST/GET /fichas)."""

    video_id: str
    url: str | None = None
    levels: Levels
    label: LabelInfo | None = None
    metadata: MetadataOut
    transcript: TranscriptOut
    storyboard: StoryboardIn | None = None
    channel: ChannelInfo | None = None
    channel_history: dict[Label, int] = Field(default_factory=dict)
    frames: list[FrameInfo] = Field(default_factory=list)
    created_at: str
    updated_at: str


# --- Etiquetas ---------------------------------------------------------------------------------


class LabelIn(BaseModel):
    video_id: str = Field(min_length=1)
    label: Label
    reason: str | None = None


class LabelOut(BaseModel):
    video_id: str
    label: Label
    reason: str | None = None
    split: Split
    labeled_at: str


class Stats(BaseModel):
    total: int = 0
    by_label: dict[Label, int] = Field(default_factory=lambda: dict.fromkeys(Label, 0))
    by_split: dict[Split, int] = Field(default_factory=lambda: {"dev": 0, "test": 0})
    shorts: int = 0
    with_transcript: int = 0


# --- Jueces (PLAN §9) --------------------------------------------------------------------------


class VideoSection(BaseModel):
    title: str
    channel: str | None = None
    category: str | None = None
    duration_s: int | None = None
    is_short: bool = False
    keywords: list[str] = Field(default_factory=list)
    description: str = ""
    chapters: list[Chapter] = Field(default_factory=list)


class ChannelSection(BaseModel):
    description: str = ""
    topics: list[str] = Field(default_factory=list)
    keywords: str = ""


class ImageRef(BaseModel):
    kind: Literal["thumbnail", "frame"]
    path: str  # relativo a `data_dir`
    t_s: float | None = None


class FichaView(BaseModel):
    """Ficha filtrada por una configuración de niveles. El juez no sabe qué se ha quitado."""

    video: VideoSection | None = None
    channel: ChannelSection | None = None
    channel_history: dict[Label, int] | None = None
    transcript_excerpt: str | None = None
    transcript_status: TranscriptStatus | None = None
    images: list[ImageRef] | None = None

    def to_state(self) -> dict[str, Any]:
        """Estado serializable (§9.3) sin imágenes: van como adjuntos según el proveedor."""
        return self.model_dump(mode="json", exclude_none=True, exclude={"images"})

    def to_state_json(self) -> str:
        return json.dumps(self.to_state(), ensure_ascii=False, separators=(",", ":"))


class Verdict(BaseModel):
    label: Label
    probs: dict[Label, float] = Field(default_factory=dict)
    confidence: float = 0.0
    aux: dict[str, Any] = Field(default_factory=dict)
    input_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0
    raw: dict[str, Any] = Field(default_factory=dict)


def build_ficha_view(
    ficha: FichaOut,
    levels: set[InfoLevel] | frozenset[InfoLevel],
    channel_history: dict[Label, int] | None = None,
) -> FichaView:
    """Construye la vista de la ficha con solo los niveles pedidos.

    `channel_history` permite inyectar un historial calculado con validación temporal
    (ablación, PLAN §10.1); si no se pasa, se usa el almacenado en la ficha.
    """
    view = FichaView()
    if InfoLevel.L0 in levels:
        history = channel_history if channel_history is not None else ficha.channel_history
        view.channel_history = {label: history.get(label, 0) for label in Label}
    if InfoLevel.L1 in levels:
        view.video = _video_section(ficha)
    if InfoLevel.L2 in levels and ficha.channel is not None:
        view.channel = ChannelSection(
            description=ficha.channel.description,
            topics=ficha.channel.topics,
            keywords=ficha.channel.keywords,
        )
    if InfoLevel.L3 in levels:
        ok = ficha.transcript.status == "ok"
        view.transcript_status = ficha.transcript.status
        view.transcript_excerpt = ficha.transcript.excerpt if ok else ""
    if InfoLevel.L4 in levels:
        view.images = [ImageRef(kind=f.kind, path=f.path, t_s=f.t_s) for f in ficha.frames]
    return view


def _video_section(ficha: FichaOut) -> VideoSection:
    meta = ficha.metadata
    return VideoSection(
        title=meta.title,
        channel=meta.channel_name,
        category=meta.category,
        duration_s=meta.duration_s,
        is_short=meta.is_short,
        keywords=meta.keywords,
        description=meta.description_clean,
        chapters=meta.chapters,
    )
