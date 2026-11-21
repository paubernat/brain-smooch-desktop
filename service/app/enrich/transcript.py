"""Muestreo de la transcripción (PLAN §7.5).

Presupuesto ~2.000 caracteres: los primeros ~800 + 4 ventanas de ~300 repartidas
uniformemente por el resto del vídeo, cada bloque precedido de su marca `[mm:ss]`.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from app.models import TranscriptSegment

HEAD_CHARS = 800
WINDOW_COUNT = 4
WINDOW_CHARS = 300
BLOCK_SEPARATOR = "\n"


@dataclass(frozen=True)
class _Segment:
    start_s: float
    text: str


def format_timestamp(seconds: float) -> str:
    """`[mm:ss]`; los minutos no se reinician en la hora (75 min → `[75:00]`)."""
    total = max(0, int(seconds))
    return f"[{total // 60:02d}:{total % 60:02d}]"


def sample_transcript(
    segments: Sequence[TranscriptSegment],
    head_chars: int = HEAD_CHARS,
    window_count: int = WINDOW_COUNT,
    window_chars: int = WINDOW_CHARS,
) -> str:
    segs = _normalize(segments)
    if not segs:
        return ""
    budget = head_chars + window_count * window_chars
    if _total_chars(segs) <= budget:
        return _render_block(segs, budget)

    head_end = _take_until(segs, 0, head_chars)
    blocks = [_render_block(segs[:head_end], head_chars)]
    for start in _window_starts(segs, head_end, window_count, window_chars):
        end = _take_until(segs, start, window_chars)
        blocks.append(_render_block(segs[start:end], window_chars))
    return BLOCK_SEPARATOR.join(blocks)


def _normalize(segments: Sequence[TranscriptSegment]) -> list[_Segment]:
    result = []
    for seg in sorted(segments, key=lambda s: s.start_s):
        text = " ".join(seg.text.split())
        if text:
            result.append(_Segment(seg.start_s, text))
    return result


def _total_chars(segs: Sequence[_Segment]) -> int:
    return sum(len(s.text) + 1 for s in segs)


def _take_until(segs: Sequence[_Segment], start: int, max_chars: int) -> int:
    """Índice final (exclusivo) de los segmentos que caben en `max_chars` (al menos uno)."""
    used = 0
    end = start
    while end < len(segs) and (end == start or used + len(segs[end].text) + 1 <= max_chars):
        used += len(segs[end].text) + 1
        end += 1
    return end


def _window_starts(
    segs: Sequence[_Segment], head_end: int, count: int, window_chars: int
) -> list[int]:
    """Índices de inicio de `count` ventanas centradas en tramos iguales del resto del texto."""
    offsets = []  # desplazamiento en caracteres del inicio de cada segmento restante
    position = 0
    for seg in segs[head_end:]:
        offsets.append(position)
        position += len(seg.text) + 1
    starts: list[int] = []
    for k in range(count):
        target = max(0.0, position * (k + 0.5) / count - window_chars / 2)
        index = head_end + _last_at_or_before(offsets, target)
        if starts and index <= starts[-1]:
            index = starts[-1] + 1
        if index >= len(segs):
            break
        starts.append(index)
    return starts


def _last_at_or_before(offsets: list[int], target: float) -> int:
    index = 0
    for i, offset in enumerate(offsets):
        if offset > target:
            break
        index = i
    return index


def _render_block(segs: Sequence[_Segment], max_chars: int) -> str:
    text = " ".join(s.text for s in segs)
    if len(text) > max_chars:
        cut = text[:max_chars]
        text = (cut[: cut.rfind(" ")] if " " in cut else cut) + "…"
    return f"{format_timestamp(segs[0].start_s)} {text}"
