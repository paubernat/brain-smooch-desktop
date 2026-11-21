from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
SERVICE_HOST = "127.0.0.1"  # nunca escuchar fuera de localhost (PLAN §0)


class Settings(BaseSettings):
    """Configuración leída del `.env` de la raíz del repo (y de variables de entorno)."""

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    youtube_api_key: str | None = None
    service_port: int = 8765
    data_dir: Path = REPO_ROOT / "data"
    channel_flush_seconds: float = 10.0
    channel_cache_days: int = 30
    http_timeout_s: float = 20.0

    @property
    def db_path(self) -> Path:
        return self.data_dir / "brain_smooch.sqlite3"

    @property
    def frames_dir(self) -> Path:
        return self.data_dir / "frames"


def get_settings() -> Settings:
    return Settings()
