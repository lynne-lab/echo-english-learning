from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    media_dir: Path
    recordings_dir: Path
    clips_dir: Path
    logs_dir: Path
    models_dir: Path
    db_path: Path
    ecdict_path: Path


settings: Settings | None = None


def init(data_dir: str | Path) -> Settings:
    global settings
    root = Path(data_dir).expanduser().resolve()
    media_dir = root / "media"
    recordings_dir = root / "recordings"
    clips_dir = root / "clips"
    logs_dir = root / "logs"
    models_dir = root / "models"
    for directory in (
        root,
        media_dir,
        recordings_dir,
        clips_dir,
        logs_dir,
        models_dir,
    ):
        directory.mkdir(parents=True, exist_ok=True)
    settings = Settings(
        data_dir=root,
        media_dir=media_dir,
        recordings_dir=recordings_dir,
        clips_dir=clips_dir,
        logs_dir=logs_dir,
        models_dir=models_dir,
        db_path=root / "echo.db",
        ecdict_path=root / "ecdict.db",
    )
    return settings
