import re

from app.enrich.transcript import format_timestamp, sample_transcript
from app.models import TranscriptSegment

MARK_RE = re.compile(r"^\[(\d{2,}):(\d{2})\] ")


def make_segments(count: int, words: int = 8, step_s: float = 4.0) -> list[TranscriptSegment]:
    return [
        TranscriptSegment(start_s=i * step_s, text=" ".join([f"w{i}"] * words))
        for i in range(count)
    ]


def seconds(block: str) -> int:
    match = MARK_RE.match(block)
    assert match, block
    return int(match.group(1)) * 60 + int(match.group(2))


def test_format_timestamp() -> None:
    assert format_timestamp(0) == "[00:00]"
    assert format_timestamp(65.9) == "[01:05]"
    assert format_timestamp(75 * 60 + 3) == "[75:03]"


def test_empty_transcript() -> None:
    assert sample_transcript([]) == ""


def test_short_transcript_is_kept_whole() -> None:
    segments = make_segments(10, words=3)
    excerpt = sample_transcript(segments)
    assert excerpt.startswith("[00:00] w0 w0 w0 w1")
    assert "\n" not in excerpt
    assert "w9" in excerpt


def test_long_transcript_head_plus_four_windows() -> None:
    segments = make_segments(1000)  # ~27.000 caracteres, ~66 minutos
    blocks = sample_transcript(segments).split("\n")
    assert len(blocks) == 5
    head, *windows = blocks
    assert seconds(head) == 0
    assert 700 <= len(head) <= 820
    assert all(len(w) <= 320 for w in windows)
    starts = [seconds(b) for b in blocks]
    assert starts == sorted(starts) and len(set(starts)) == 5
    # repartidas: la última ventana cae en el último cuarto del vídeo
    assert starts[-1] > 0.75 * 1000 * 4 * 0.9
    assert len("\n".join(blocks)) <= 2100


def test_segments_are_sorted_and_whitespace_normalised() -> None:
    segments = [
        TranscriptSegment(start_s=10, text="second"),
        TranscriptSegment(start_s=0, text="  first \n line "),
        TranscriptSegment(start_s=5, text="   "),
    ]
    assert sample_transcript(segments) == "[00:00] first line second"
