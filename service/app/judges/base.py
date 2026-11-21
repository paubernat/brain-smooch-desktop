"""Interfaz común de los jueces (PLAN §9.1) y utilidades compartidas por los adaptadores.

Formatos de petición/respuesta: solo los de docs/judges-api-notes.md.
"""

import base64
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

import httpx

from app.models import FichaView, Label, Verdict
from app.policy import Policy
from app.pricing import Pricing

log = logging.getLogger(__name__)

MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}
# Ante la duda, LIMITADO (PLAN §2): es el veredicto de respaldo si no hay respuesta válida.
FALLBACK_LABEL = Label.LIMITADO


@runtime_checkable
class Judge(Protocol):
    name: str  # clave del registro, p. ej. "liquid/d1.2-ultra" (también clave de pricing.yaml)
    provider: str  # "liquid" | "openai" | "anthropic" (columna `judge` de verdicts)
    model: str  # id del modelo en el proveedor (columna `model` de verdicts)
    supports_images: bool

    async def decide(self, ficha: FichaView, policy: Policy) -> Verdict: ...


class JudgeError(Exception):
    """Error no recuperable (4xx distinto de 429, respuesta ilegible...)."""


class RetryableJudgeError(JudgeError):
    """429 / 5xx / fallo de transporte: se puede reintentar con backoff."""

    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


@dataclass(frozen=True)
class EncodedImage:
    media_type: str
    data: str  # base64

    @property
    def data_url(self) -> str:
        return f"data:{self.media_type};base64,{self.data}"


def state_json(ficha: FichaView) -> str:
    """Estado §9.3: JSON compacto y legible, sin imágenes (van como adjuntos)."""
    return ficha.to_state_json()


def load_images(ficha: FichaView, data_dir: Path, limit: int | None = None) -> list[EncodedImage]:
    """Lee los fotogramas de `data/frames` como base64. Los ficheros que falten se omiten."""
    images: list[EncodedImage] = []
    for ref in ficha.images or []:
        path = data_dir / ref.path
        media_type = MEDIA_TYPES.get(path.suffix.lower())
        if media_type is None or not path.is_file():
            log.warning("Skipping image %s (missing or unsupported)", path)
            continue
        images.append(EncodedImage(media_type, base64.b64encode(path.read_bytes()).decode("ascii")))
        if limit is not None and len(images) >= limit:
            break
    return images


def confidence_from_probs(probs: dict[Label, float]) -> float:
    """Confianza = probabilidad máxima (cuando el proveedor no la define)."""
    return max(probs.values(), default=0.0)


def parse_label(value: Any) -> Label | None:
    """Etiqueta sin distinguir mayúsculas (Anthropic no garantiza la capitalización del enum)."""
    if not isinstance(value, str):
        return None
    try:
        return Label(value.strip().upper())
    except ValueError:
        return None


def label_probs(pairs: dict[str, float]) -> dict[Label, float]:
    """Probabilidades por etiqueta; ausentes → 0, claves desconocidas se descartan."""
    probs = dict.fromkeys(Label, 0.0)
    for key, value in pairs.items():
        label = parse_label(key)
        if label is not None:
            probs[label] = float(value)
    return probs


def retry_after_seconds(response: httpx.Response) -> float | None:
    value = response.headers.get("retry-after")
    try:
        return float(value) if value is not None else None
    except ValueError:
        return None


def check_response(response: httpx.Response) -> dict[str, Any]:
    """Reintentar 429 y 5xx; el resto de 4xx no (notas de Liquid; mismo criterio para todos)."""
    status = response.status_code
    if status == 429 or status >= 500:
        raise RetryableJudgeError(
            f"HTTP {status}: {response.text[:300]}", retry_after_seconds(response)
        )
    if status >= 400:
        raise JudgeError(f"HTTP {status}: {response.text[:300]}")
    try:
        body = response.json()
    except ValueError as exc:
        raise JudgeError(f"Invalid JSON response: {response.text[:300]}") from exc
    if not isinstance(body, dict):
        raise JudgeError("Response body is not a JSON object")
    return body


class HttpJudge:
    """Base de los adaptadores HTTP: cliente compartido, clave, precios y medición de latencia."""

    name: str
    provider: str
    model: str
    supports_images: bool = True
    url: str

    def __init__(
        self,
        client: httpx.AsyncClient,
        api_key: str,
        pricing: Pricing,
        data_dir: Path,
        timeout_s: float = 60.0,
    ) -> None:
        self.client = client
        self.api_key = api_key
        self.pricing = pricing
        self.data_dir = data_dir
        self.timeout_s = timeout_s

    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    async def post(self, body: dict[str, Any]) -> tuple[dict[str, Any], int]:
        """POST JSON; devuelve (respuesta, latencia en ms)."""
        start = time.perf_counter()
        try:
            response = await self.client.post(
                self.url, json=body, headers=self.headers(), timeout=self.timeout_s
            )
        except httpx.TransportError as exc:  # incluye timeouts
            raise RetryableJudgeError(f"{type(exc).__name__}: {exc}") from exc
        latency_ms = round((time.perf_counter() - start) * 1000)
        return check_response(response), latency_ms

    def images(self, ficha: FichaView, limit: int | None = None) -> list[EncodedImage]:
        if not self.supports_images:
            return []
        return load_images(ficha, self.data_dir, limit)

    def cost(self, input_tokens: int, output_tokens: int = 0) -> float:
        return self.pricing.cost(self.name, input_tokens, output_tokens)
