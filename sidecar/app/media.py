from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

AUDIO_EXTENSIONS = {".mp3", ".m4a", ".wav", ".flac", ".ogg", ".opus", ".aac", ".wma"}
VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mkv", ".webm", ".mov", ".avi", ".flv", ".ts"}
ALLOWED_EXTENSIONS = AUDIO_EXTENSIONS | VIDEO_EXTENSIONS


def ffmpeg_available() -> bool:
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def probe_media(path: Path) -> tuple[str, float | None]:
    """Return (media_type, duration_seconds). Never raises."""
    fallback_type = "video" if path.suffix.lower() in VIDEO_EXTENSIONS else "audio"
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_type:stream_disposition=attached_pic",
                "-of",
                "json",
                str(path),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
        )
        data = json.loads(result.stdout or "{}")
        duration = None
        raw_duration = (data.get("format") or {}).get("duration")
        if raw_duration:
            duration = float(raw_duration)
        has_video = False
        for stream in data.get("streams") or []:
            if stream.get("codec_type") != "video":
                continue
            disposition = stream.get("disposition") or {}
            if disposition.get("attached_pic") in (1, "1", True):
                continue
            has_video = True
        return ("video" if has_video else "audio"), duration
    except Exception:
        return fallback_type, None


def find_media_file(directory: Path, material_id: str) -> Path | None:
    candidates = [
        path
        for path in directory.glob(f"{material_id}.*")
        if path.suffix.lower() in ALLOWED_EXTENSIONS and path.is_file()
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda path: path.stat().st_size)
