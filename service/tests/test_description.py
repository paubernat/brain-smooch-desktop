from app.enrich.description import MAX_CHARS, clean_description
from tests.helpers import read_fixture

# Descripción real del Short ib6nIB-fbNE (videoDetails.shortDescription, descargada de YouTube).
REAL_DESCRIPTION = read_fixture("ib6nIB-fbNE_description.txt")


def test_real_short_keeps_course_titles_and_drops_links() -> None:
    cleaned = clean_description(REAL_DESCRIPTION)
    assert cleaned.splitlines() == [
        "Get the Chord/Scale Charts (free)",
        "MY PIANO COURSES",
        "Chord Theory for R&B Piano",
        "Sick Chords Vol. 1",
        "Stanky Loops",
        "MY SOLOING COURSES",
        "The Soloing System",
        "Chord Tone Magic",
        "Sick Licks",
        "Solo with Soul",
    ]


def test_real_short_has_no_urls_social_or_emoji() -> None:
    cleaned = clean_description(REAL_DESCRIPTION)
    for forbidden in ("http", "jeffschneidermusic", "Instagram", "Facebook", "FOLLOW", "⭐", "📸"):
        assert forbidden not in cleaned


def test_loose_social_lines_are_removed_outside_blocks() -> None:
    raw = (
        "Great lesson on voicings\nInstagram: https://instagram.com/x\n🐦 Twitter - https://t.co/a"
    )
    assert clean_description(raw) == "Great lesson on voicings"


def test_social_block_ends_at_blank_line() -> None:
    raw = "SOCIALS\nTikTok: https://tiktok.com/@x\nPatreon https://patreon.com/x\n\nChapters below"
    assert clean_description(raw) == "Chapters below"


def test_link_text_is_kept_and_empty_lines_removed() -> None:
    raw = "\n\nFull course (https://bit.ly/abc)\n\n\nhttps://example.com/only-a-link\n\nwww.foo.com/x\n"
    assert clean_description(raw) == "Full course"


def test_chapters_and_hashtags_survive() -> None:
    raw = "0:00 Intro\n1:23 The tritone sub\n#jazz #piano"
    assert clean_description(raw) == raw


def test_repeated_decorative_emoji_removed() -> None:
    assert clean_description("🔥🔥🔥 NEW VIDEO 🔥🔥🔥") == "NEW VIDEO"


def test_output_is_capped() -> None:
    raw = "\n".join(f"Line number {i} with some words in it" for i in range(200))
    cleaned = clean_description(raw)
    assert len(cleaned) <= MAX_CHARS
    assert cleaned.endswith("in it")  # se corta en un límite de línea


def test_empty_description() -> None:
    assert clean_description("") == ""
