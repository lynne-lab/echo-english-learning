from __future__ import annotations

import logging
import time
from pathlib import Path

import yt_dlp

from . import config, db, media

logger = logging.getLogger(__name__)


def download_material(material_id: str, url: str) -> None:
    if config.settings is None:
        raise RuntimeError("settings is not initialised")

    db.update_material(material_id, stage="正在解析链接", progress=0.03, error=None)
    last_update = 0.0

    def progress_hook(data: dict) -> None:
        nonlocal last_update
        now = time.time()
        if now - last_update < 0.6:
            return
        last_update = now
        if data.get("status") != "downloading":
            return
        downloaded = float(data.get("downloaded_bytes") or 0)
        total = float(data.get("total_bytes") or data.get("total_bytes_estimate") or 0)
        if total <= 0:
            db.update_material(material_id, stage="正在下载", progress=0.15)
            return
        pct = min(downloaded / total, 1.0)
        db.update_material(
            material_id,
            stage=f"正在下载 {int(pct * 100)}%",
            progress=0.03 + 0.27 * pct,
        )

    out_template = str(config.settings.media_dir / f"{material_id}.%(ext)s")
    options = {
        "format": "bv*[height<=720]+ba/b[height<=720]/b",
        "merge_output_format": "mp4",
        "outtmpl": out_template,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "retries": 3,
        "fragment_retries": 3,
        "concurrent_fragment_downloads": 4,
        "progress_hooks": [progress_hook],
        "restrictfilenames": False,
    }

    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=True)
    except Exception as exc:
        logger.exception("yt-dlp failed for %s", url)
        message = str(exc).strip() or "下载失败"
        raise RuntimeError(f"链接下载失败：{message[:800]}") from exc

    if info and info.get("_type") == "playlist":
        entries = [entry for entry in (info.get("entries") or []) if entry]
        if entries:
            info = entries[0]

    path = media.find_media_file(config.settings.media_dir, material_id)
    if path is None:
        raise RuntimeError("下载完成但没有找到媒体文件")

    media_type, duration = media.probe_media(path)
    if duration is None and info:
        try:
            duration = float(info.get("duration") or 0) or None
        except (TypeError, ValueError):
            duration = None

    title = (info or {}).get("title") or path.stem
    title = " ".join(str(title).split())[:200]

    db.update_material(
        material_id,
        title=title,
        file_path=str(path.resolve()),
        media_type=media_type,
        duration=duration,
        stage="下载完成",
        progress=0.3,
    )
