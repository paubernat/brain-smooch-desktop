import json

from app.models import (
    ALL_LEVELS,
    ChannelInfo,
    FichaOut,
    FrameInfo,
    InfoLevel,
    Label,
    Levels,
    MetadataOut,
    TranscriptOut,
    build_ficha_view,
)


def stored_ficha(transcript_status: str = "ok") -> FichaOut:
    return FichaOut(
        video_id="ib6nIB-fbNE",
        levels=Levels(L2="ok", L3=transcript_status, L4="ok"),
        metadata=MetadataOut(
            title="These Chords So Nasty (you've been warned)",
            description_raw="raw",
            description_clean="Chord Theory for R&B Piano",
            keywords=["jazz piano"],
            category="Music",
            duration_s=120,
            is_short=True,
            channel_name="Jeff Schneider",
        ),
        transcript=TranscriptOut(status=transcript_status, excerpt="[00:00] hello"),
        channel=ChannelInfo(
            channel_id="UC1", description="Piano", topics=["Music"], keywords="jazz"
        ),
        channel_history={Label.LIBRE: 3},
        frames=[
            FrameInfo(kind="thumbnail", idx=0, path="frames/x/thumbnail.jpg"),
            FrameInfo(kind="frame", idx=0, t_s=10, path="frames/x/frame_0.jpg"),
        ],
        created_at="2026-01-01T00:00:00+00:00",
        updated_at="2026-01-01T00:00:00+00:00",
    )


def test_full_view_matches_state_shape() -> None:
    view = build_ficha_view(stored_ficha(), ALL_LEVELS)
    state = view.to_state()
    assert set(state) == {
        "video", "channel", "channel_history", "transcript_excerpt", "transcript_status",
    }  # fmt: skip
    assert state["video"]["channel"] == "Jeff Schneider"
    assert state["video"]["description"] == "Chord Theory for R&B Piano"
    assert state["channel"] == {"description": "Piano", "topics": ["Music"], "keywords": "jazz"}
    assert state["channel_history"] == {"NO": 0, "LIMITADO": 0, "LIBRE": 3}
    assert view.images is not None and len(view.images) == 2


def test_view_only_contains_requested_levels() -> None:
    view = build_ficha_view(stored_ficha(), {InfoLevel.L1, InfoLevel.L3})
    assert view.channel is None and view.channel_history is None and view.images is None
    assert set(view.to_state()) == {"video", "transcript_excerpt", "transcript_status"}


def test_missing_transcript_is_explicit() -> None:
    view = build_ficha_view(stored_ficha("none"), {InfoLevel.L3})
    assert view.to_state() == {"transcript_excerpt": "", "transcript_status": "none"}


def test_channel_history_override_for_temporal_validation() -> None:
    view = build_ficha_view(stored_ficha(), {InfoLevel.L0}, channel_history={Label.NO: 1})
    assert view.channel_history == {Label.NO: 1, Label.LIMITADO: 0, Label.LIBRE: 0}


def test_state_json_is_compact_and_utf8() -> None:
    text = build_ficha_view(stored_ficha(), {InfoLevel.L1}).to_state_json()
    assert ", " not in text and "you've" in text
    assert json.loads(text)["video"]["is_short"] is True
