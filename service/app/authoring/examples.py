"""Resúmenes compactos de fichas para los prompts del editor agéntico."""

from typing import Any

from app.models import FichaView

MAX_KEYWORDS = 10
MAX_DESCRIPTION = 400
MAX_CHANNEL_DESCRIPTION = 250
MAX_TRANSCRIPT = 400


def _clip(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def compact_summary(view: FichaView) -> dict[str, Any]:
    """Lo esencial de la ficha que vio el juez (mismos niveles), recortado."""
    summary: dict[str, Any] = {}
    if view.video is not None:
        v = view.video
        summary.update(
            title=v.title,
            channel=v.channel,
            category=v.category,
            duration_s=v.duration_s,
            is_short=v.is_short,
            keywords=v.keywords[:MAX_KEYWORDS],
            description=_clip(v.description, MAX_DESCRIPTION),
        )
    if view.channel is not None:
        summary["channel_description"] = _clip(view.channel.description, MAX_CHANNEL_DESCRIPTION)
        summary["channel_topics"] = view.channel.topics
    if view.transcript_excerpt:
        summary["transcript_excerpt"] = _clip(view.transcript_excerpt, MAX_TRANSCRIPT)
    return {k: v for k, v in summary.items() if v not in (None, "", [])}
