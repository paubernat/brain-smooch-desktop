"""Recalibración de la política con las etiquetas pendientes.

Cada etiqueta (y su «motivo») queda pendiente hasta que se incorpora a la política: el usuario
pide una propuesta (`POST /policy/refresh`), la revisa y, al guardarla, las etiquetas usadas se
marcan como incorporadas con la versión nueva (tabla `policy_feedback`).

Solo el split `dev` alimenta la recalibración: el split `test` queda reservado para la ablación
final (PLAN §10.2) y aquí solo se cuenta, como información.
"""

from collections.abc import Sequence

from pydantic import BaseModel, Field

from app import db
from app.authoring.examples import compact_summary
from app.authoring.models import FeedbackExample, FeedbackRef
from app.models import Label, PendingLabel, Split
from eval import ablation

FEEDBACK_SPLIT: Split = "dev"
REFRESH_HINT_AT = 20  # a partir de aquí el panel sugiere refrescar la política


class FeedbackItem(BaseModel):
    video_id: str
    title: str
    channel: str | None = None
    label: Label
    reason: str | None = None
    is_short: bool = False
    labeled_at: str


class FeedbackOut(BaseModel):
    split: Split = FEEDBACK_SPLIT
    pending: int  # etiquetas dev pendientes
    by_label: dict[Label, int] = Field(default_factory=lambda: dict.fromkeys(Label, 0))
    with_reason: int = 0
    pending_test: int = 0  # solo informativo: nunca se usan para recalibrar
    hint_threshold: int = REFRESH_HINT_AT
    items: list[FeedbackItem] = Field(default_factory=list)  # dev, más recientes primero


def _pending(database: db.Database) -> list[PendingLabel]:
    with database.connect() as conn:
        return db.pending_labels(conn)


def feedback_summary(database: db.Database, include_items: bool = True) -> FeedbackOut:
    pending = _pending(database)
    dev = [p for p in pending if p.split == FEEDBACK_SPLIT]
    out = FeedbackOut(
        pending=len(dev),
        with_reason=sum(1 for p in dev if p.reason),
        pending_test=len(pending) - len(dev),
    )
    for item in dev:
        out.by_label[item.label] += 1
    if include_items:
        out.items = [
            FeedbackItem(**p.model_dump(exclude={"split"}))
            for p in sorted(dev, key=lambda p: p.labeled_at, reverse=True)
        ]
    return out


def pending_dev_examples(database: db.Database, config: str) -> list[FeedbackExample]:
    """Etiquetas dev pendientes con la ficha resumida (mismos niveles que `config`)."""
    examples = []
    for item in _pending(database):
        if item.split != FEEDBACK_SPLIT:
            continue
        with database.connect() as conn:
            ficha = db.load_ficha(conn, item.video_id)
        if ficha is None:
            continue
        video = ablation.LabeledVideo(ficha, item.label, item.labeled_at)
        examples.append(
            FeedbackExample(
                video_id=item.video_id,
                labeled_at=item.labeled_at,
                label=item.label,
                reason=(item.reason or "").strip() or None,
                summary=compact_summary(ablation.build_view(database, video, config)),
            )
        )
    return examples


def mark_incorporated(
    database: db.Database, refs: Sequence[FeedbackRef], policy_version: int
) -> int:
    with database.connect() as conn:
        return db.mark_labels_incorporated(
            conn, ((r.video_id, r.labeled_at) for r in refs), policy_version
        )
