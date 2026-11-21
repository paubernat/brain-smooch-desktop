"""Llamada a Claude con salida estructurada para el editor de la política (httpx, sin SDK,
igual que el juez Sonnet). Reintenta 429/5xx con backoff corto."""

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from app.anthropic_api import (
    ANTHROPIC_URL,
    SONNET_MODEL,
    anthropic_headers,
    output_text,
    structured_request,
    usage_tokens,
)
from app.authoring.models import AuthorUsage
from app.judges.base import JudgeError, RetryableJudgeError, check_response
from app.pricing import Pricing

log = logging.getLogger(__name__)

MAX_TOKENS = 16000
MAX_RETRIES = 2
PRICE_KEYS = {SONNET_MODEL: "anthropic/sonnet"}  # modelo → clave de pricing.yaml


class AuthoringError(JudgeError):
    """Claude no devolvió un borrador utilizable (rechazo, salida truncada o ilegible)."""


class ClaudeAuthorClient:
    def __init__(
        self,
        client: httpx.AsyncClient,
        api_key: str,
        model: str,
        pricing: Pricing,
        timeout_s: float = 180.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.client = client
        self.api_key = api_key
        self.model = model
        self.pricing = pricing
        self.timeout_s = timeout_s
        self.sleep = sleep

    async def complete(
        self, system: str, user: str, schema: dict[str, Any]
    ) -> tuple[dict[str, Any], AuthorUsage]:
        """Devuelve la JSON estructurada y el uso de tokens."""
        body = structured_request(
            self.model, MAX_TOKENS, [{"type": "text", "text": user}], schema, system=system
        )
        data = await self._post_with_retries(body)
        input_tokens, output_tokens = usage_tokens(data)
        usage = AuthorUsage(
            model=self.model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=self._cost(input_tokens, output_tokens),
        )
        stop_reason = data.get("stop_reason")
        if stop_reason == "refusal":
            raise AuthoringError("Claude declined to write the policy (stop_reason=refusal)")
        if stop_reason == "max_tokens":
            raise AuthoringError("Claude output was truncated (stop_reason=max_tokens)")
        text = output_text(data)
        try:
            parsed = json.loads(text) if isinstance(text, str) else None
        except json.JSONDecodeError as exc:
            raise AuthoringError("Unparseable structured output") from exc
        if not isinstance(parsed, dict):
            raise AuthoringError("Missing structured output")
        return parsed, usage

    async def _post_with_retries(self, body: dict[str, Any]) -> dict[str, Any]:
        attempt = 0
        while True:
            try:
                return await self._post(body)
            except RetryableJudgeError as exc:
                if attempt >= MAX_RETRIES:
                    raise
                delay = exc.retry_after if exc.retry_after is not None else 2.0 * 2**attempt
                log.info("policy author: retry %d in %.1fs (%s)", attempt + 1, delay, exc)
                await self.sleep(delay)
                attempt += 1

    async def _post(self, body: dict[str, Any]) -> dict[str, Any]:
        try:
            response = await self.client.post(
                ANTHROPIC_URL,
                json=body,
                headers=anthropic_headers(self.api_key),
                timeout=self.timeout_s,
            )
        except httpx.TransportError as exc:
            raise RetryableJudgeError(f"{type(exc).__name__}: {exc}") from exc
        return check_response(response)

    def _cost(self, input_tokens: int, output_tokens: int) -> float | None:
        key = PRICE_KEYS.get(self.model)
        if key is None or key not in self.pricing.models:
            return None
        return self.pricing.cost(key, input_tokens, output_tokens)
