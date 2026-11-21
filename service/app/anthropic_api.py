"""Piezas compartidas de la Messages API de Anthropic con salida estructurada
(`output_config.format`, docs/judges-api-notes.md §3). Las usan el juez Sonnet y el
editor agéntico de la política.
"""

from typing import Any

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2026-10-21"
SONNET_MODEL = "claude-sonnet-5-5"


def anthropic_headers(api_key: str) -> dict[str, str]:
    return {
        "x-api-key": api_key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }


def structured_request(
    model: str,
    max_tokens: int,
    content: list[dict[str, Any]],
    schema: dict[str, Any],
    system: str | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": content}],
        "output_config": {"format": {"type": "json_schema", "schema": schema}},
    }
    if system:
        body["system"] = system
    return body


def output_text(data: dict[str, Any]) -> str | None:
    """Texto del primer bloque `text` (donde llega la JSON de la salida estructurada)."""
    return next((b.get("text") for b in data.get("content") or [] if b.get("type") == "text"), None)


def usage_tokens(data: dict[str, Any]) -> tuple[int, int]:
    usage = data.get("usage") or {}
    return int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0)
