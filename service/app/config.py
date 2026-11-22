import os
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
SERVICE_HOST = "127.0.0.1"  # nunca escuchar fuera de localhost (PLAN §0)

# Instalación de producción (PLAN-FASE2 §3, §9): servicio de Windows como LocalSystem con
# los datos en `C:\ProgramData\BrainSmooch\`. Se activa con `BS_PRODUCTION=1` (lo pone el XML
# de WinSW); sin ella se usan las rutas del repo (desarrollo).
PRODUCTION_ENV = "BS_PRODUCTION"
PROGRAM_DATA_DIR = Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "BrainSmooch"
_SYSTEM_ROOT = Path(os.environ.get("SYSTEMROOT", r"C:\Windows"))
DEFAULT_HOSTS_PATH = _SYSTEM_ROOT / "System32" / "drivers" / "etc" / "hosts"
DEFAULT_FIREFOX_DIR = Path(r"C:\Program Files\Mozilla Firefox")

BrowserWatchMode = Literal["off", "observe", "enforce"]


class Settings(BaseSettings):
    """Configuración leída del `.env` de la raíz del repo (y de variables de entorno)."""

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    youtube_api_key: str | None = None
    liquid_api_key: str | None = None
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None  # opcional (solo experimentos con Sonnet)
    service_port: int = 8765
    data_dir: Path = REPO_ROOT / "data"
    channel_flush_seconds: float = 10.0
    channel_cache_days: int = 30
    http_timeout_s: float = 20.0
    judge_timeout_s: float = 60.0
    policy_path: Path = REPO_ROOT / "policy" / "policy.yaml"
    policy_history_dir: Path = REPO_ROOT / "policy" / "history"
    pricing_path: Path = REPO_ROOT / "service" / "pricing.yaml"
    policy_author_model: str = "claude-sonnet-5-5"  # editor agéntico de la política
    policy_author_timeout_s: float = 180.0
    # Juez en directo: espera máxima a L2/L4 antes de decidir con lo que haya.
    live_wait_s: float = 8.0
    # Duración de la sesión de administrador tras meter la contraseña; 0 = un solo uso.
    admin_session_s: float = 600.0
    live_poll_s: float = 0.5

    # --- capas de Windows (PLAN-FASE2 §4, app/enforce/) ---
    bs_production: bool = False
    # Aplicar y reparar capas (E4-E6, E9). Por defecto solo en producción: en desarrollo el
    # servicio solo las LEE para mostrar su estado, nunca escribe en el sistema.
    bs_enforce_layers: bool | None = None
    # Vigilante de navegadores (E7): `observe` solo anota, `enforce` cierra el proceso.
    bs_browser_watch: BrowserWatchMode = "off"
    program_data_dir: Path = PROGRAM_DATA_DIR
    firefox_dir: Path = DEFAULT_FIREFOX_DIR
    hosts_path: Path = DEFAULT_HOSTS_PATH
    integrity_interval_s: float = 60.0
    browser_watch_interval_s: float = 3.0

    @property
    def enforce_layers(self) -> bool:
        return self.bs_production if self.bs_enforce_layers is None else self.bs_enforce_layers

    @property
    def extension_dir(self) -> Path:
        """XPI firmado que fuerza `policies.json` (lo copia el instalador)."""
        return self.program_data_dir / "extension"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "brain_smooch.sqlite3"

    @property
    def frames_dir(self) -> Path:
        return self.data_dir / "frames"


def production_mode() -> bool:
    return os.environ.get(PRODUCTION_ENV, "").strip() == "1"


def get_settings() -> Settings:
    if not production_mode():
        return Settings()
    base = PROGRAM_DATA_DIR
    # `service.env` (modo del vigilante, lo escribe el instalador) y `secrets.env` (claves de
    # API; ACL solo SYSTEM/Administradores) sustituyen al `.env` del repo.
    return Settings(
        _env_file=(base / "service.env", base / "secrets.env"),  # type: ignore[call-arg]
        bs_production=True,
        program_data_dir=base,
        data_dir=base / "data",
        policy_path=base / "policy" / "policy.yaml",
        policy_history_dir=base / "policy" / "history",
    )
