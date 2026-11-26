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


# A sentence may span several Whisper segments: the model splits long speech at
# VAD pauses, not at sentence boundaries. Only these rules end a sentence.
PAUSE_SENTENCE_GAP = 0.9
MIN_SENTENCE_WORDS = 6
MAX_SENTENCE_WORDS = 45
MAX_SENTENCE_SECONDS = 25.0


def _join_words(words: list[dict[str, Any]]) -> str:
    """Join word tokens without relying on Whisper's leading spaces."""
    parts: list[str] = []
    for word in words:
        token = word["w"]
        stripped = token.strip()
        if not parts:
            parts.append(stripped)
            continue
        if token[:1].isspace():
            parts.append(token)
        elif stripped and re.match(r"^[.,!?;:…)\]}\"'’\-]", stripped):
            parts.append(stripped)
        else:
            parts.append(f" {stripped}")
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def _sentence_from_words(words: list[dict[str, Any]]) -> dict[str, Any] | None:
    text = _join_words(words)
    if not text:
        return None
    return {
        "start": round(words[0]["s"], 3),
        "end": round(words[-1]["e"], 3),
        "text": text,
        "words": [
            {
                "w": word["w"].strip(),
                "s": round(word["s"], 3),
                "e": round(word["e"], 3),
            }
            for word in words
        ],
    }


def split_units(units: list[tuple[str, Any]]) -> list[dict[str, Any]]:
    """Group a stream of word/segment units into sentences.

    Words are joined across Whisper segments. A sentence ends on end
    punctuation, a long pause (when enough words have accumulated), or as a
    safety limit for unpunctuated speech. Segments without word timestamps
    stand alone.
    """
    results: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []

    def flush() -> None:
        sentence = _sentence_from_words(current)
        if sentence:
            results.append(sentence)
        current.clear()

    for kind, payload in units:
        if kind == "segment":
            if current:
                flush()
            text = re.sub(r"\s+", " ", str(payload["text"])).strip()
            if text:
                results.append(
                    {
                        "start": round(float(payload["start"]), 3),
                        "end": round(float(payload["end"]), 3),
                        "text": text,
                        "words": None,
                    }
                )
            continue

        word = payload
        if current:
            gap = word["s"] - current[-1]["e"]
            if gap > PAUSE_SENTENCE_GAP and len(current) >= MIN_SENTENCE_WORDS:
                flush()
        current.append(word)
        long_enough = (
            len(current) >= MAX_SENTENCE_WORDS
            or (current[-1]["e"] - current[0]["s"]) >= MAX_SENTENCE_SECONDS
        )
        if _ends_sentence(word["w"]) or long_enough:
            flush()

    if current:
        flush()
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

    units: list[tuple[str, Any]] = []
    last_update = 0.0
    for segment in segments_iter:
        words = list(getattr(segment, "words", None) or [])
        if words:
            for word in words:
                try:
                    start = float(word.start)
                    end = float(word.end)
                except (TypeError, ValueError):
                    continue
                units.append(("word", {"w": str(word.word), "s": start, "e": end}))
        else:
            text = re.sub(r"\s+", " ", (segment.text or "")).strip()
            if text:
                units.append(
                    (
                        "segment",
                        {
                            "start": float(segment.start),
                            "end": float(segment.end),
                            "text": text,
                        },
                    )
                )
        now = time.time()
        if now - last_update > 0.8:
            last_update = now
            pct = min(float(segment.end) / duration, 1.0) if duration > 0 else 0.0
            db.update_material(
                material_id,
                stage=f"正在识别语音 {int(pct * 100)}%",
                progress=0.35 + 0.55 * pct,
            )
    return split_units(units), duration


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


def transcribe_short_audio_details(file_path: str) -> dict[str, Any]:
    """Transcribe a conversation turn and keep word-level confidence.

    Low-probability words are a weak signal that the learner's pronunciation
    may have been unclear; they are only used as hints, never as phoneme scores.
    """
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
                word_timestamps=True,
            )
            texts: list[str] = []
            words: list[dict[str, Any]] = []
            for segment in segments:
                if segment.text:
                    texts.append(segment.text.strip())
                for word in getattr(segment, "words", None) or []:
                    token = str(word.word).strip()
                    if not token:
                        continue
                    try:
                        probability = float(word.probability)
                    except (TypeError, ValueError):
                        probability = 1.0
                    words.append(
                        {
                            "w": token,
                            "p": round(probability, 3),
                            "s": round(float(word.start), 3),
                            "e": round(float(word.end), 3),
                        }
                    )
            text = re.sub(r"\s+", " ", " ".join(texts)).strip()
            weak: list[str] = []
            for word in words:
                token = re.sub(r"[^A-Za-z']", "", word["w"])
                if not token or word["p"] >= 0.55:
                    continue
                if token.lower() not in [item.lower() for item in weak]:
                    weak.append(token)
            return {
                "text": text,
                "words": words[:300],
                "weak_words": weak[:12],
            }
        except Exception as exc:
            if attempt == 0 and runtime.get("device") == "cuda" and _is_cuda_error(exc):
                logger.warning(
                    "CUDA short-audio inference failed, retrying on CPU: %s", exc
                )
                force_cpu()
                model = _load_model(model_size)
                continue
            raise
    return {"text": "", "words": [], "weak_words": []}


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
