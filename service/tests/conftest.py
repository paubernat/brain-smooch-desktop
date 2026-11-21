import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest
import respx

from app import db
from app.config import REPO_ROOT, Settings


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        _env_file=None,  # type: ignore[call-arg]
        youtube_api_key="test-key",
        data_dir=tmp_path / "data",
        channel_flush_seconds=3600,
    )


@pytest.fixture
def database(settings: Settings) -> Iterator[db.Database]:
    database = db.Database(settings.db_path)
    database.init()
    yield database


@pytest.fixture
def policy_settings(settings: Settings) -> Settings:
    """Copia de `policy/policy.yaml` en tmp y claves falsas (los tests nunca llaman a nadie)."""
    policy_dir = settings.data_dir.parent / "policy"
    policy_dir.mkdir(parents=True)
    shutil.copy(REPO_ROOT / "policy" / "policy.yaml", policy_dir / "policy.yaml")
    settings.policy_path = policy_dir / "policy.yaml"
    settings.policy_history_dir = policy_dir / "history"
    settings.anthropic_api_key = "sk-test"
    settings.liquid_api_key = "liquid-test"
    return settings


@pytest.fixture
def mock_net() -> Iterator[respx.MockRouter]:
    """Red simulada: solo pasa el TestClient; el resto hay que mockearlo en cada test."""
    with respx.mock(assert_all_called=False) as router:
        router.route(host="testserver").pass_through()
        yield router
