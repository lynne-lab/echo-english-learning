from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import db
from .download import download_material
from .transcribe import reset_model, transcribe_material

logger = logging.getLogger(__name__)

executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="echo-job")


def submit_material(material_id: str, redownload: bool = False) -> None:
    db.update_material(
        material_id,
        status="processing",
        stage="排队中",
        progress=0.0,
        error=None,
    )
    executor.submit(_run, material_id, redownload)


def _run(material_id: str, redownload: bool) -> None:
    try:
        material = db.get_material(material_id)
        if not material:
            return

        needs_download = material["source_type"] == "url" and (
            redownload
            or not material.get("file_path")
            or not Path(material["file_path"]).exists()
        )
        if needs_download:
            if not material.get("source_url"):
                raise RuntimeError("缺少原始链接，无法重新下载")
            download_material(material_id, material["source_url"])
            material = db.get_material(material_id)
            if not material:
                return

        db.update_material(material_id, stage="准备转写", progress=0.3)
        transcribe_material(material_id)
    except Exception as exc:
        logger.exception("material job failed: %s", material_id)
        db.update_material(
            material_id,
            status="error",
            stage="失败",
            error=str(exc)[:2000] or "未知错误",
        )


def change_model(_new_model: str) -> None:
    reset_model()
