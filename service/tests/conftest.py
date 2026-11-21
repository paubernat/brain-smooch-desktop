from collections.abc import Iterator
from pathlib import Path

import pytest

from app import db
from app.config import Settings


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
