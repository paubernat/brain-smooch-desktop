"""Precios por modelo (`service/pricing.yaml`) y estimación de tokens para `--dry-run`."""

import math
from pathlib import Path

import yaml
from pydantic import BaseModel, Field

PER_MTOK = 1_000_000


class ModelPrice(BaseModel):
    input_per_mtok: float = 0.0
    output_per_mtok: float = 0.0
    image_tokens: int | None = None  # sobrescribe `estimate.image_tokens` para este modelo


class EstimateSettings(BaseModel):
    chars_per_token: float = 4.0
    image_tokens: int = 1500


class Pricing(BaseModel):
    estimate: EstimateSettings = Field(default_factory=EstimateSettings)
    models: dict[str, ModelPrice] = Field(default_factory=dict)

    def price(self, model_key: str) -> ModelPrice:
        try:
            return self.models[model_key]
        except KeyError:
            raise KeyError(f"No price for {model_key!r} in pricing.yaml") from None

    def cost(self, model_key: str, input_tokens: int, output_tokens: int = 0) -> float:
        price = self.price(model_key)
        return (
            input_tokens * price.input_per_mtok + output_tokens * price.output_per_mtok
        ) / PER_MTOK

    def estimate_tokens(self, model_key: str, chars: int, images: int) -> int:
        """tokens ≈ caracteres / chars_per_token + imágenes × asignación por imagen."""
        per_image = self.price(model_key).image_tokens or self.estimate.image_tokens
        return math.ceil(chars / self.estimate.chars_per_token) + images * per_image


def load_pricing(path: Path) -> Pricing:
    return Pricing.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")) or {})
