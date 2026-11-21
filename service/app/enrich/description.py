"""Limpieza de la descripción del vídeo (PLAN §7.4).

- Quita URLs y tokens de redirección pero conserva el texto que acompaña al enlace
  ("Chord Theory for R&B Piano: https://..." → "Chord Theory for R&B Piano").
- Quita bloques de redes sociales ("FOLLOW ME", Instagram, X…), emojis decorativos y
  líneas vacías.
- Limita el resultado a ~1.500 caracteres.
"""

import re

MAX_CHARS = 1500

URL_RE = re.compile(
    r"(?:https?://|www\.)[^\s()<>\[\]]+"
    r"|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|ly|gl|me|co|tv|gg|link|app)/[^\s()<>\[\]]*",
    re.IGNORECASE,
)
EMOJI_RE = re.compile(
    "["
    "\U0001f000-\U0001faff"  # pictogramas, emoticonos, banderas, símbolos suplementarios
    "☀-➿"  # símbolos varios y dingbats
    "⬀-⯿"  # flechas y estrellas (⭐)
    "⌀-⏿"  # técnicos (⌚, ⏰…)
    "️︎‍⃣"  # selectores de variación, ZWJ, keycap
    "]+"
)
SOCIAL_HEADER_RE = re.compile(
    r"^(?:follow|connect|find|socials?|social media|stay connected|my socials|redes|"
    r"sígueme|sigueme|encuéntrame|contacto|contact)\b.*$",
    re.IGNORECASE,
)
SOCIAL_NETWORKS = frozenset(
    {
        "instagram", "ig", "facebook", "fb", "twitter", "x", "tiktok", "twitch", "discord",
        "threads", "snapchat", "linkedin", "reddit", "bluesky", "mastodon", "whatsapp",
        "telegram", "kick",
    }
)  # fmt: skip
TRAILING_PUNCT = " \t:;-–—|•·>→=,"
MEANINGLESS_RE = re.compile(r"^[\W_]*$")


def clean_description(raw: str, max_chars: int = MAX_CHARS) -> str:
    lines = _drop_social_blocks(raw.splitlines())
    cleaned = [_clean_line(line) for line in lines]
    kept = [line for line in cleaned if line and not MEANINGLESS_RE.match(line)]
    return _truncate("\n".join(_dedupe_consecutive(kept)), max_chars)


def _drop_social_blocks(lines: list[str]) -> list[str]:
    """Elimina desde una cabecera tipo "FOLLOW ME" hasta la siguiente línea en blanco,
    y cualquier línea suelta cuyo rótulo sea una red social."""
    result: list[str] = []
    in_block = False
    for line in lines:
        text = _strip_emoji(line).strip()
        if not text:
            in_block = False
            result.append(line)
            continue
        if in_block or _is_social_header(text):
            in_block = True
            continue
        if _is_social_link_line(text):
            continue
        result.append(line)
    return result


def _is_social_header(text: str) -> bool:
    return bool(SOCIAL_HEADER_RE.match(text)) and len(text) <= 60 and not URL_RE.search(text)


def _is_social_link_line(text: str) -> bool:
    label = _link_label(text)
    if label is None:
        return False
    return label.lower().strip(TRAILING_PUNCT) in SOCIAL_NETWORKS


def _link_label(text: str) -> str | None:
    """Texto que precede a la primera URL de la línea, o None si no hay URL."""
    match = URL_RE.search(text)
    return None if match is None else text[: match.start()]


def _clean_line(line: str) -> str:
    text = URL_RE.sub(" ", line)
    text = _strip_emoji(text)
    text = re.sub(r"\s+", " ", text).strip(TRAILING_PUNCT)
    # Paréntesis o corchetes vacíos que quedan al quitar un enlace: "Curso ()" → "Curso"
    text = re.sub(r"[(\[]\s*[)\]]", "", text).strip(TRAILING_PUNCT)
    return text


def _strip_emoji(text: str) -> str:
    return EMOJI_RE.sub("", text)


def _dedupe_consecutive(lines: list[str]) -> list[str]:
    result: list[str] = []
    for line in lines:
        if not result or result[-1] != line:
            result.append(line)
    return result


def _truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars]
    newline = cut.rfind("\n")
    if newline >= max_chars * 0.8:
        return cut[:newline]
    space = cut.rfind(" ")
    return (cut[:space] if space > 0 else cut).rstrip() + "…"
