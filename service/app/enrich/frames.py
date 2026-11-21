"""L4 — Fotogramas (PLAN §7.6).

Descarga los sprites del storyboard, recorta 6 fotogramas repartidos uniformemente y la
miniatura, los reescala a ≤ 512 px de lado largo y los guarda como JPEG (calidad 80) en
`data/frames/<video_id>/`.
"""

import asyncio
import io
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import httpx
from PIL import Image

from app.models import FrameInfo, StoryboardIn, StoryboardLevel

FRAME_COUNT = 6
MAX_SIDE = 512
JPEG_QUALITY = 80
THUMBNAIL_FALLBACKS = ("maxresdefault", "sddefault", "hqdefault")
DEFAULT_THUMBNAIL_URL = "https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg"


@dataclass(frozen=True)
class FramePosition:
    frame: int  # índice global del fotograma en el storyboard
    sprite: int  # índice del sprite (imagen) que lo contiene
    column: int
    row: int


def spread_indices(total: int, count: int = FRAME_COUNT) -> list[int]:
    """`count` índices repartidos uniformemente en [0, total), centrados en cada tramo."""
    if total <= 0:
        return []
    count = min(count, total)
    return [int((k + 0.5) * total / count) for k in range(count)]


def locate_frame(frame: int, level: StoryboardLevel) -> FramePosition:
    per_sprite = level.columns * level.rows
    sprite, position = divmod(frame, per_sprite)
    row, column = divmod(position, level.columns)
    return FramePosition(frame=frame, sprite=sprite, column=column, row=row)


def available_frames(level: StoryboardLevel, sprite_count: int) -> int:
    return min(level.frame_count, sprite_count * level.columns * level.rows)


def crop_frame(sprite: Image.Image, position: FramePosition, level: StoryboardLevel) -> Image.Image:
    """Recorta una celda del sprite; usa el tamaño real de la celda si el sprite no coincide."""
    cell_w = min(level.width, sprite.width // level.columns) or level.width
    cell_h = min(level.height, sprite.height // level.rows) or level.height
    left, top = position.column * cell_w, position.row * cell_h
    box = (left, top, min(left + cell_w, sprite.width), min(top + cell_h, sprite.height))
    return sprite.crop(box)


def crop_storyboard(
    sprites: Sequence[Image.Image | None], level: StoryboardLevel, count: int = FRAME_COUNT
) -> list[tuple[FramePosition, Image.Image]]:
    """Fotogramas repartidos uniformemente; se saltan los de sprites no disponibles (None)."""
    total = available_frames(level, len(sprites))
    positions = [locate_frame(i, level) for i in spread_indices(total, count)]
    return [
        (p, crop_frame(sprite, p, level))
        for p in positions
        if (sprite := sprites[p.sprite]) is not None
    ]


def resize_to_max(image: Image.Image, max_side: int = MAX_SIDE) -> Image.Image:
    image = image.convert("RGB")
    if max(image.size) > max_side:
        image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    return image


def save_jpeg(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    resize_to_max(image).save(path, format="JPEG", quality=JPEG_QUALITY)


def thumbnail_candidates(url: str) -> list[str]:
    """La URL dada y, si es de `i.ytimg.com`, las variantes de menor resolución por si da 404."""
    candidates = [url]
    for name in THUMBNAIL_FALLBACKS:
        for other in THUMBNAIL_FALLBACKS:
            if name in url and other != name:
                candidates.append(url.replace(name, other))
    return list(dict.fromkeys(candidates))


async def download_image(client: httpx.AsyncClient, url: str) -> Image.Image:
    response = await client.get(url)
    response.raise_for_status()
    image = Image.open(io.BytesIO(response.content))
    image.load()
    return image


async def download_thumbnail(client: httpx.AsyncClient, url: str) -> Image.Image | None:
    for candidate in thumbnail_candidates(url):
        try:
            return await download_image(client, candidate)
        except (httpx.HTTPError, OSError):
            continue
    return None


def default_thumbnail_url(video_id: str) -> str:
    return DEFAULT_THUMBNAIL_URL.format(video_id=video_id)


async def extract_frames(
    client: httpx.AsyncClient, video_id: str, storyboard: StoryboardIn | None, data_dir: Path
) -> list[FrameInfo]:
    """Descarga, recorta y guarda. Devuelve los fotogramas con rutas relativas a `data_dir`.

    Sin storyboard se guarda solo la miniatura (maxresdefault → ... → hqdefault).
    """
    out_dir = data_dir / "frames" / video_id
    frames: list[FrameInfo] = []
    thumbnail_url = (storyboard and storyboard.thumbnail_url) or default_thumbnail_url(video_id)
    thumbnail = await download_thumbnail(client, thumbnail_url)
    if thumbnail is not None:
        frames.append(_store(thumbnail, out_dir / "thumbnail.jpg", data_dir, "thumbnail", 0))
    if storyboard is not None and storyboard.sprite_urls:
        sprites = await _download_needed_sprites(client, storyboard)
        frames.extend(_store_crops(sprites, storyboard.level, out_dir, data_dir))
    return frames


async def _download_needed_sprites(
    client: httpx.AsyncClient, storyboard: StoryboardIn
) -> list[Image.Image | None]:
    """Descarga solo los sprites que contienen algún fotograma elegido."""
    level = storyboard.level
    total = available_frames(level, len(storyboard.sprite_urls))
    needed = {locate_frame(i, level).sprite for i in spread_indices(total)}
    images = await asyncio.gather(
        *(download_image(client, storyboard.sprite_urls[i]) for i in sorted(needed))
    )
    sprites: list[Image.Image | None] = [None] * len(storyboard.sprite_urls)
    for index, image in zip(sorted(needed), images, strict=True):
        sprites[index] = image
    return sprites


def _store_crops(
    sprites: list[Image.Image | None], level: StoryboardLevel, out_dir: Path, data_dir: Path
) -> list[FrameInfo]:
    frames = []
    for idx, (position, crop) in enumerate(crop_storyboard(sprites, level)):
        t_s = position.frame * level.interval_ms / 1000 if level.interval_ms else None
        frames.append(_store(crop, out_dir / f"frame_{idx}.jpg", data_dir, "frame", idx, t_s))
    return frames


def _store(
    image: Image.Image,
    path: Path,
    data_dir: Path,
    kind: str,
    idx: int,
    t_s: float | None = None,
) -> FrameInfo:
    save_jpeg(image, path)
    relative = path.relative_to(data_dir).as_posix()
    return FrameInfo(kind=kind, idx=idx, t_s=t_s, path=relative)  # type: ignore[arg-type]
