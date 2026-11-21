from pathlib import Path

import httpx
import respx
from PIL import Image

from app.enrich.frames import (
    MAX_SIDE,
    crop_storyboard,
    extract_frames,
    locate_frame,
    resize_to_max,
    spread_indices,
    thumbnail_candidates,
)
from app.models import StoryboardIn, StoryboardLevel
from tests.helpers import (
    LEVEL,
    THUMB_URL,
    VIDEO_ID,
    frame_color,
    make_sprite,
    png_bytes,
    sprite_urls,
)


def test_spread_indices() -> None:
    assert spread_indices(60) == [5, 15, 25, 35, 45, 55]
    assert spread_indices(3) == [0, 1, 2]
    assert spread_indices(0) == []


def test_locate_frame() -> None:
    position = locate_frame(37, LEVEL)  # 25 por sprite → sprite 1, posición 12 → fila 2, col 2
    assert (position.sprite, position.row, position.column) == (1, 2, 2)


def test_crop_storyboard_picks_the_right_cells() -> None:
    sprites = [make_sprite(LEVEL, i) for i in range(3)]
    crops = crop_storyboard(sprites, LEVEL)
    assert len(crops) == 6
    for position, image in crops:
        assert image.size == (LEVEL.width, LEVEL.height)
        assert image.getpixel((LEVEL.width // 2, LEVEL.height // 2)) == frame_color(position.frame)


def test_crop_storyboard_limits_to_available_sprites() -> None:
    level = StoryboardLevel(width=10, height=10, frame_count=500, columns=2, rows=2)
    crops = crop_storyboard([make_sprite(level, 0)], level)
    assert [p.frame for p, _ in crops] == [0, 1, 2, 3]


def test_resize_to_max() -> None:
    big = Image.new("RGB", (1280, 720))
    assert max(resize_to_max(big).size) == MAX_SIDE
    small = Image.new("RGB", (160, 90))
    assert resize_to_max(small).size == (160, 90)


def test_thumbnail_candidates() -> None:
    assert thumbnail_candidates(THUMB_URL) == [
        THUMB_URL,
        THUMB_URL.replace("maxresdefault", "sddefault"),
        THUMB_URL.replace("maxresdefault", "hqdefault"),
    ]


@respx.mock
async def test_extract_frames_downloads_crops_and_saves(tmp_path: Path) -> None:
    urls = sprite_urls()
    for n, url in enumerate(urls):
        sprite = png_bytes(make_sprite(LEVEL, n))
        respx.get(url).mock(return_value=httpx.Response(200, content=sprite))
    respx.get(THUMB_URL).mock(return_value=httpx.Response(404))
    thumb = png_bytes(Image.new("RGB", (1280, 720), "red"))
    respx.get(THUMB_URL.replace("maxresdefault", "sddefault")).mock(
        return_value=httpx.Response(200, content=thumb)
    )
    storyboard = StoryboardIn(thumbnail_url=THUMB_URL, level=LEVEL, sprite_urls=urls)

    async with httpx.AsyncClient() as client:
        frames = await extract_frames(client, VIDEO_ID, storyboard, tmp_path)

    assert [f.kind for f in frames] == ["thumbnail"] + ["frame"] * 6
    assert [f.t_s for f in frames if f.kind == "frame"] == [10, 30, 50, 70, 90, 110]
    for frame in frames:
        path = tmp_path / frame.path
        assert path.is_file() and path.parent == tmp_path / "frames" / VIDEO_ID
        with Image.open(path) as image:
            assert image.format == "JPEG" and max(image.size) <= MAX_SIDE
    with Image.open(tmp_path / frames[0].path) as thumbnail:
        assert thumbnail.size == (512, 288)
