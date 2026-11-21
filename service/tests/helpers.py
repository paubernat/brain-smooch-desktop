"""Utilidades compartidas por los tests (sin red)."""

import io
from pathlib import Path
from typing import Any

from PIL import Image

from app.models import StoryboardLevel

FIXTURES = Path(__file__).parent / "fixtures"
# Copia fija de policy/policy.yaml: la real cambia cada vez que el usuario guarda su perfil.
POLICY_FIXTURE = FIXTURES / "policy.yaml"
VIDEO_ID = "ib6nIB-fbNE"
CHANNEL_ID = "UCjeffschneider000000000"
THUMB_URL = f"https://i.ytimg.com/vi/{VIDEO_ID}/maxresdefault.jpg"
SPRITE_URL = "https://i.ytimg.com/sb/{vid}/storyboard3_L2/M{n}.jpg?sqp=abc&sigh=xyz"
LEVEL = StoryboardLevel(width=160, height=90, frame_count=60, columns=5, rows=5, interval_ms=2000)


def read_fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def frame_color(frame: int) -> tuple[int, int, int]:
    """Color único por fotograma para comprobar qué celda se ha recortado."""
    return ((frame * 4) % 256, 255 - (frame * 4) % 256, (frame * 37) % 256)


def make_sprite(level: StoryboardLevel, sprite_index: int) -> Image.Image:
    per_sprite = level.columns * level.rows
    image = Image.new("RGB", (level.width * level.columns, level.height * level.rows))
    for pos in range(per_sprite):
        frame = sprite_index * per_sprite + pos
        row, col = divmod(pos, level.columns)
        box = (col * level.width, row * level.height,
               (col + 1) * level.width, (row + 1) * level.height)  # fmt: skip
        image.paste(frame_color(frame), box)
    return image


def png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")  # sin pérdidas: colores exactos en los tests
    return buffer.getvalue()


def sprite_urls(video_id: str = VIDEO_ID, count: int = 3) -> list[str]:
    return [SPRITE_URL.format(vid=video_id, n=n) for n in range(count)]


def ficha_payload(
    video_id: str = VIDEO_ID,
    *,
    channel_id: str | None = CHANNEL_ID,
    with_storyboard: bool = True,
    transcript_status: str = "ok",
    is_short: bool = True,
) -> dict[str, Any]:
    segments = (
        [{"start_s": float(i * 5), "text": f"segment {i} about chord voicings"} for i in range(80)]
        if transcript_status == "ok"
        else []
    )
    storyboard = {
        "thumbnail_url": f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg",
        "level": LEVEL.model_dump(),
        "sprite_urls": sprite_urls(video_id),
    }
    return {
        "video_id": video_id,
        "url": f"https://www.youtube.com/shorts/{video_id}",
        "metadata": {
            "title": "These Chords So Nasty (you've been warned)",
            "description_raw": read_fixture("ib6nIB-fbNE_description.txt"),
            "keywords": ["jazz piano", "jazz chords"],
            "category": "Music",
            "duration_s": 120,
            "is_short": is_short,
            "chapters": [],
            "channel_id": channel_id,
            "channel_name": "Jeff Schneider",
            "publish_date": "2025-01-01",
            "is_family_safe": True,
            "game": None,
        },
        "transcript": {
            "status": transcript_status,
            "language": "en",
            "kind": "asr",
            "segments": segments,
        },
        "storyboard": storyboard if with_storyboard else None,
    }


def channel_api_item(channel_id: str = CHANNEL_ID) -> dict[str, Any]:
    return {
        "kind": "youtube#channel",
        "id": channel_id,
        "snippet": {"title": "Jeff Schneider", "description": "Jazz & R&B piano lessons."},
        "topicDetails": {
            "topicCategories": [
                "https://en.wikipedia.org/wiki/Music",
                "https://en.wikipedia.org/wiki/Jazz",
            ]
        },
        "brandingSettings": {"channel": {"keywords": 'piano jazz "music theory"'}},
    }
