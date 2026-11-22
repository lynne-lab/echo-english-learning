from __future__ import annotations

import logging
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from . import config, db

logger = logging.getLogger(__name__)

_model = None
_model_key: str | None = None
_model_lock = threading.Lock()
runtime: dict[str, Any] = {"device": None, "model": None, "last_error": None}

_ABBREVIATIONS = {
    "mr.",
    "mrs.",
    "ms.",
    "dr.",
    "prof.",
    "sr.",
    "jr.",
    "st.",
    "vs.",
    "etc.",
    "e.g.",
    "i.e.",
    "a.m.",
    "p.m.",
}


def reset_model() -> None:
    global _model, _model_key
    with _model_lock:
        _model = None
        _model_key = None
    runtime.update(device=None, model=None, last_error=None)


def force_cpu() -> None:
    global _model, _model_key
    with _model_lock:
        _model = None
        _model_key = None
    runtime.update(device="cpu", model=None)


def _load_model(size: str):
    global _model, _model_key
    with _model_lock:
        if _model is not None and _model_key == size:
            return _model

        from .cuda import add_cuda_dll_directories

        add_cuda_dll_directories()

        from faster_whisper import WhisperModel

        attempts: list[tuple[str, str]] = []
        if runtime.get("device") != "cpu":
            attempts.append(("cuda", "float16"))
        attempts.append(("cpu", "int8"))

        last_error: Exception | None = None
        for device, compute_type in attempts:
            try:
                logger.info("loading whisper model %s on %s/%s", size, device, compute_type)
                model = WhisperModel(
                    size,
                    device=device,
                    compute_type=compute_type,
                    download_root=str(config.settings.models_dir),
                    num_workers=1,
                )
                runtime.update(device=device, model=size, last_error=None)
                _model = model
                _model_key = size
                return model
            except Exception as exc:
                logger.warning("whisper load failed on %s: %s", device, exc)
                runtime["last_error"] = str(exc)
                last_error = exc
                if device == "cuda":
                    runtime["device"] = "cpu"

        raise RuntimeError(f"无法加载 Whisper 模型：{last_error}")


def _ends_sentence(word: str) -> bool:
    text = word.strip()
    if not re.search(r"[.!?…][\"')\]]*$", text):
        return False
    if text.lower().rstrip("\"')]") in _ABBREVIATIONS:
        return False
    return True


def _word_count(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9']+", text))


def split_segment(segment: Any) -> list[dict[str, Any]]:
    words = list(getattr(segment, "words", None) or [])
    if not words:
        text = re.sub(r"\s+", " ", (segment.text or "")).strip()
        if not text:
            return []
        return [
            {
                "start": round(float(segment.start), 3),
                "end": round(float(segment.end), 3),
                "text": text,
                "words": None,
            }
        ]

    chunks: list[list[Any]] = []
    current: list[Any] = []
    for index, word in enumerate(words):
        current.append(word)
        following = words[index + 1] if index + 1 < len(words) else None
        text_so_far = "".join(w.word for w in current).strip()
        long_pause = (
            following is not None
            and (float(following.start) - float(word.end)) > 0.9
            and _word_count(text_so_far) >= 6
        )
        if _ends_sentence(word.word) or long_pause or following is None:
            chunks.append(current)
            current = []

    results: list[dict[str, Any]] = []
    for chunk in chunks:
        text = "".join(w.word for w in chunk)
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            continue
        results.append(
            {
                "start": round(float(chunk[0].start), 3),
                "end": round(float(chunk[-1].end), 3),
                "text": text,
                "words": [
                    {
                        "w": str(w.word).strip(),
                        "s": round(float(w.start), 3),
                        "e": round(float(w.end), 3),
                    }
                    for w in chunk
                ],
            }
        )
    return results


def _save_sentences(material_id: str, sentences: list[dict[str, Any]], previous_occurrences: list[Any]) -> None:
    now = db.now_iso()
    with db.get_conn() as conn:
        conn.execute("DELETE FROM sentences WHERE material_id = ?", (material_id,))
        new_ids: list[str] = []
        for index, sentence in enumerate(sentences):
            sentence_id = uuid.uuid4().hex
            new_ids.append(sentence_id)
            words_json = None
            if sentence.get("words") is not None:
                import json

                words_json = json.dumps(sentence["words"], ensure_ascii=False)
            conn.execute(
                """
                INSERT INTO sentences
                    (id, material_id, idx, start, end, text, original_text, words_json)
                VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
                """,
                (
                    sentence_id,
                    material_id,
                    index,
                    sentence["start"],
                    sentence["end"],
                    sentence["text"],
                    words_json,
                ),
            )

        # 重新转写时尽量把原来的生词出处接回时间最接近的新句子。
        for occurrence in previous_occurrences:
            nearest = conn.execute(
                """
                SELECT id, text, start FROM sentences
                WHERE material_id = ?
                ORDER BY ABS(start - ?) ASC
                LIMIT 1
                """,
                (material_id, occurrence["start"]),
            ).fetchone()
            if nearest and abs(float(nearest["start"]) - float(occurrence["start"])) <= 3.0:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO word_occurrences
                        (id, word_id, sentence_id, material_id, context, surface, note, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
                    """,
                    (
                        uuid.uuid4().hex,
                        occurrence["word_id"],
                        nearest["id"],
                        material_id,
                        nearest["text"],
                        occurrence["surface"],
                        now,
                    ),
                )


def _collect_sentences(
    model: Any, file_path: str, material_id: str, duration: float
) -> tuple[list[dict[str, Any]], float]:
    segments_iter, info = model.transcribe(
        file_path,
        language="en",
        beam_size=5,
        vad_filter=True,
        word_timestamps=True,
        condition_on_previous_text=True,
        vad_parameters={"min_silence_duration_ms": 400},
    )

    info_duration = float(getattr(info, "duration", 0) or 0)
    if duration <= 0 and info_duration > 0:
        duration = info_duration
        db.update_material(material_id, duration=duration)

    sentences: list[dict[str, Any]] = []
    last_update = 0.0
    for segment in segments_iter:
        sentences.extend(split_segment(segment))
        now = time.time()
        if now - last_update > 0.8:
            last_update = now
            pct = min(float(segment.end) / duration, 1.0) if duration > 0 else 0.0
            db.update_material(
                material_id,
                stage=f"正在识别语音 {int(pct * 100)}%",
                progress=0.35 + 0.55 * pct,
            )
    return sentences, duration


def _is_cuda_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return any(keyword in message for keyword in ("cublas", "cudnn", "cuda driver", "cuda runtime"))


def transcribe_short_audio(file_path: str) -> str:
    """Transcribe a short shadowing recording for local feedback."""
    model_size = db.get_setting("whisper_model", "small.en") or "small.en"
    model = _load_model(model_size)
    for attempt in range(2):
        try:
            segments, _info = model.transcribe(
                file_path,
                language="en",
                beam_size=5,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            text = " ".join(segment.text.strip() for segment in segments).strip()
            return re.sub(r"\s+", " ", text)
        except Exception as exc:
            if attempt == 0 and runtime.get("device") == "cuda" and _is_cuda_error(exc):
                logger.warning("CUDA short-audio inference failed, retrying on CPU: %s", exc)
                force_cpu()
                model = _load_model(model_size)
                continue
            raise
    return ""


def transcribe_material(material_id: str) -> None:
    material = db.get_material(material_id)
    if not material:
        raise RuntimeError("素材不存在")
    file_path = material.get("file_path")
    if not file_path or not Path(file_path).exists():
        raise RuntimeError("媒体文件不存在，请重新导入或重试")

    model_size = db.get_setting("whisper_model", "small.en") or "small.en"
    db.update_material(material_id, stage="正在加载识别模型", progress=0.32)
    model = _load_model(model_size)

    db.update_material(material_id, stage="正在识别语音", progress=0.35)

    duration = float(material.get("duration") or 0)
    sentences: list[dict[str, Any]] = []
    for attempt in range(2):
        try:
            sentences, duration = _collect_sentences(model, file_path, material_id, duration)
            break
        except Exception as exc:
            if attempt == 0 and runtime.get("device") == "cuda" and _is_cuda_error(exc):
                logger.warning("CUDA inference failed, falling back to CPU: %s", exc)
                force_cpu()
                db.update_material(
                    material_id,
                    stage="GPU 不可用，改用 CPU 转写",
                    progress=0.35,
                )
                model = _load_model(model_size)
                continue
            raise

    if not sentences:
        raise RuntimeError("没有识别到语音内容，可能是纯音乐或静音文件")

    with db.get_conn() as conn:
        previous_occurrences = conn.execute(
            """
            SELECT o.word_id, s.start, o.surface
            FROM word_occurrences o
            JOIN sentences s ON s.id = o.sentence_id
            WHERE s.material_id = ?
            """,
            (material_id,),
        ).fetchall()

    db.update_material(material_id, stage="正在整理句子", progress=0.93)
    _save_sentences(material_id, sentences, previous_occurrences)
    db.update_material(
        material_id,
        status="ready",
        stage="已完成",
        progress=1.0,
        error=None,
    )
