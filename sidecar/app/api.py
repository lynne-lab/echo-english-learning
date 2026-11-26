from __future__ import annotations

import mimetypes
import re
import subprocess
import uuid
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from . import config, db, dictionary, jobs, shadow_review, srs
from .conversation_api import router as conversation_router
from .dictation_api import router as dictation_router
from .media import ALLOWED_EXTENSIONS, ffmpeg_available, probe_media
from .module_state_api import router as module_state_router
from .plan_api import router as plan_router
from .progress_api import router as progress_router
from .recordings_api import router as recordings_router
from .reviews_api import router as reviews_router
from .shadow_review_api import router as shadow_review_router
from .stats_api import router as stats_router
from .transcribe import runtime

WHISPER_MODELS = [
    {"id": "tiny.en", "label": "Tiny (English)", "size": "~75 MB", "note": "最快，准确率一般"},
    {"id": "base.en", "label": "Base (English)", "size": "~145 MB", "note": "速度快，适合清晰语音"},
    {"id": "small.en", "label": "Small (English)", "size": "~480 MB", "note": "推荐，速度和准确率均衡"},
    {"id": "medium.en", "label": "Medium (English)", "size": "~1.5 GB", "note": "更准，CPU 上较慢"},
    {"id": "large-v3", "label": "Large v3", "size": "~3 GB", "note": "最准，建议 GPU"},
]
MODEL_IDS = {model["id"] for model in WHISPER_MODELS}
# Bump when the clip extraction logic changes so stale WAVs are ignored.
CLIP_VERSION = 2

app = FastAPI(title="Echo Sidecar", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
)
app.include_router(reviews_router)
app.include_router(dictation_router)
app.include_router(stats_router)
app.include_router(recordings_router)
app.include_router(plan_router)
app.include_router(progress_router)
app.include_router(module_state_router)
app.include_router(shadow_review_router)
app.include_router(conversation_router)


# ---------------------------------------------------------------- 基础信息


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "version": "1.0.0",
        "whisper_model": db.get_setting("whisper_model", "small.en"),
        "device": runtime.get("device") or "auto",
        "model_loaded": runtime.get("model"),
        "dictionary_entries": dictionary.entry_count(),
        "ffmpeg": ffmpeg_available(),
    }


# ---------------------------------------------------------------- 素材


def _material_or_404(material_id: str) -> dict[str, Any]:
    material = db.get_material(material_id)
    if not material:
        raise HTTPException(status_code=404, detail="素材不存在")
    return material


class LocalImportRequest(BaseModel):
    path: str
    title: str | None = None


class UrlImportRequest(BaseModel):
    url: str


class MaterialPatch(BaseModel):
    title: str = Field(min_length=1)


@app.get("/api/materials")
def list_materials() -> list[dict[str, Any]]:
    return db.list_materials()


@app.post("/api/materials/local")
def import_local(payload: LocalImportRequest) -> dict[str, Any]:
    path = Path(payload.path).expanduser()
    if not path.exists():
        raise HTTPException(status_code=400, detail="文件不存在")
    if not path.is_file():
        raise HTTPException(status_code=400, detail="请选择一个文件")
    if path.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="不支持这个文件格式")

    media_type, duration = probe_media(path)
    material_id = uuid.uuid4().hex
    now = db.now_iso()
    title = " ".join((payload.title or path.stem).split())[:200] or path.stem
    with db.get_conn() as conn:
        conn.execute(
            """
            INSERT INTO materials
                (id, title, source_type, source_url, file_path, media_type, duration,
                 status, stage, progress, language, created_at, updated_at)
            VALUES (?, ?, 'local', NULL, ?, ?, ?, 'processing', '排队中', 0, 'en', ?, ?)
            """,
            (
                material_id,
                title,
                str(path.resolve()),
                media_type,
                duration,
                now,
                now,
            ),
        )
    jobs.submit_material(material_id)
    return _material_or_404(material_id)


@app.post("/api/materials/url")
def import_url(payload: UrlImportRequest) -> dict[str, Any]:
    url = payload.url.strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="请输入有效的 http/https 链接")
    material_id = uuid.uuid4().hex
    now = db.now_iso()
    title = f"链接素材 · {parsed.netloc}"[:200]
    with db.get_conn() as conn:
        conn.execute(
            """
            INSERT INTO materials
                (id, title, source_type, source_url, file_path, media_type, duration,
                 status, stage, progress, language, created_at, updated_at)
            VALUES (?, ?, 'url', ?, NULL, 'video', NULL,
                    'processing', '排队中', 0, 'en', ?, ?)
            """,
            (material_id, title, url, now, now),
        )
    jobs.submit_material(material_id)
    return _material_or_404(material_id)


@app.get("/api/materials/{material_id}")
def get_material(material_id: str) -> dict[str, Any]:
    return _material_or_404(material_id)


@app.get("/api/materials/{material_id}/sentences")
def get_sentences(material_id: str) -> list[dict[str, Any]]:
    _material_or_404(material_id)
    return db.list_sentences(material_id)


@app.patch("/api/materials/{material_id}")
def patch_material(material_id: str, payload: MaterialPatch) -> dict[str, Any]:
    _material_or_404(material_id)
    title = " ".join(payload.title.split())[:200]
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")
    db.update_material(material_id, title=title)
    return _material_or_404(material_id)


@app.get("/api/materials/{material_id}/related")
def get_material_related(material_id: str) -> dict[str, int]:
    _material_or_404(material_id)
    with db.get_conn() as conn:
        recordings = conn.execute(
            "SELECT COUNT(*) FROM recordings WHERE material_id = ?",
            (material_id,),
        ).fetchone()[0]
        reviews = conn.execute(
            "SELECT COUNT(*) FROM shadow_reviews WHERE material_id = ?",
            (material_id,),
        ).fetchone()[0]
    return {"recordings": int(recordings), "reviews": int(reviews)}


@app.delete("/api/materials/{material_id}")
def delete_material(
    material_id: str, keep_reviews: bool = False
) -> dict[str, Any]:
    material = _material_or_404(material_id)

    if config.settings is not None:
        with db.get_conn() as conn:
            sentence_ids = [
                row["id"]
                for row in conn.execute(
                    "SELECT id FROM sentences WHERE material_id = ?", (material_id,)
                ).fetchall()
            ]
            recording_rows = conn.execute(
                "SELECT file_path FROM recordings WHERE material_id = ?",
                (material_id,),
            ).fetchall()
        for row in recording_rows:
            try:
                Path(row["file_path"]).unlink(missing_ok=True)
            except OSError:
                pass
        for sentence_id in sentence_ids:
            for suffix in (".wav", f".v{CLIP_VERSION}.wav"):
                try:
                    (config.settings.clips_dir / f"{sentence_id}{suffix}").unlink(
                        missing_ok=True
                    )
                except OSError:
                    pass

    with db.get_conn() as conn:
        conn.execute("DELETE FROM recordings WHERE material_id = ?", (material_id,))
        if not keep_reviews:
            conn.execute(
                "DELETE FROM shadow_reviews WHERE material_id = ?", (material_id,)
            )
        conn.execute("DELETE FROM materials WHERE id = ?", (material_id,))

    if material.get("source_type") == "url" and config.settings is not None:
        media_dir = config.settings.media_dir.resolve()
        for path in media_dir.glob(f"{material_id}.*"):
            try:
                if path.resolve().parent == media_dir and path.is_file():
                    path.unlink()
            except OSError:
                pass
    return {"ok": True}


@app.post("/api/materials/{material_id}/retry")
def retry_material(material_id: str) -> dict[str, Any]:
    material = _material_or_404(material_id)
    if material["status"] == "processing":
        raise HTTPException(status_code=409, detail="这个素材正在处理中")
    jobs.submit_material(material_id)
    return _material_or_404(material_id)


# ---------------------------------------------------------------- 媒体文件


def _iter_file(path: Path, start: int, end: int, chunk_size: int = 256 * 1024) -> Iterator[bytes]:
    with path.open("rb") as handle:
        handle.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            data = handle.read(min(chunk_size, remaining))
            if not data:
                break
            remaining -= len(data)
            yield data


@app.get("/api/media/{material_id}")
def stream_media(material_id: str, request: Request):
    material = _material_or_404(material_id)
    file_path = material.get("file_path")
    if not file_path:
        raise HTTPException(status_code=404, detail="媒体文件尚未准备好")
    path = Path(file_path)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="媒体文件不存在")
    size = path.stat().st_size
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"

    range_header = request.headers.get("range")
    if range_header:
        match = re.match(r"bytes=(\d*)-(\d*)\s*$", range_header)
        if match:
            start_text, end_text = match.groups()
            if start_text == "" and end_text == "":
                match = None
            elif start_text == "":
                suffix = int(end_text)
                start = max(size - suffix, 0)
                end = size - 1
            else:
                start = int(start_text)
                end = int(end_text) if end_text else size - 1
            if match:
                if start >= size or start > end:
                    return Response(
                        status_code=416,
                        headers={"Content-Range": f"bytes */{size}"},
                    )
                end = min(end, size - 1)
                headers = {
                    "Content-Range": f"bytes {start}-{end}/{size}",
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(end - start + 1),
                    "Cache-Control": "no-store",
                }
                return StreamingResponse(
                    _iter_file(path, start, end),
                    status_code=206,
                    media_type=mime,
                    headers=headers,
                )

    return FileResponse(
        path,
        media_type=mime,
        headers={"Accept-Ranges": "bytes", "Cache-Control": "no-store"},
    )


# ---------------------------------------------------------------- 句子编辑


class SentencePatch(BaseModel):
    text: str = Field(min_length=1)


@app.get("/api/sentences/{sentence_id}/clip")
def get_sentence_clip(sentence_id: str):
    sentence = db.get_sentence(sentence_id)
    if not sentence:
        raise HTTPException(status_code=404, detail="句子不存在")
    material = db.get_material(sentence["material_id"])
    if not material or not material.get("file_path"):
        raise HTTPException(status_code=404, detail="素材文件不存在")
    media_path = Path(material["file_path"])
    if not media_path.exists():
        raise HTTPException(status_code=404, detail="素材文件不存在")
    if config.settings is None:
        raise HTTPException(status_code=500, detail="数据目录未初始化")

    clip_path = (
        config.settings.clips_dir / f"{sentence_id}.v{CLIP_VERSION}.wav"
    )
    if not clip_path.exists():
        # Drop the pre-versioned cache entry for this sentence.
        (config.settings.clips_dir / f"{sentence_id}.wav").unlink(
            missing_ok=True
        )
        start = max(0.0, float(sentence["start"]) - 0.1)
        # Whisper's last word can end a fraction of a second early; keep a
        # little tail so final consonants are not clipped.
        duration = max(
            0.3, float(sentence["end"]) - float(sentence["start"]) + 0.45
        )
        temporary = (
            config.settings.clips_dir
            / f"{sentence_id}.{uuid.uuid4().hex}.part.wav"
        )
        # Input seeking (-ss before -i) can land late on VBR MP3s, so decode
        # from the start for MP3 and seek accurately. Other containers keep
        # the faster input seek.
        if media_path.suffix.lower() == ".mp3":
            seek_args = ["-i", str(media_path), "-ss", f"{start:.3f}"]
        else:
            seek_args = ["-ss", f"{start:.3f}", "-i", str(media_path)]
        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-loglevel",
                    "error",
                    *seek_args,
                    "-t",
                    f"{duration:.3f}",
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-c:a",
                    "pcm_s16le",
                    str(temporary),
                ],
                check=True,
                timeout=90,
                capture_output=True,
            )
            temporary.replace(clip_path)
        except subprocess.CalledProcessError as exc:
            temporary.unlink(missing_ok=True)
            detail = (
                exc.stderr.decode("utf-8", "replace")[:300]
                if exc.stderr
                else "ffmpeg 退出异常"
            )
            raise HTTPException(
                status_code=500, detail=f"提取原句音频失败：{detail}"
            ) from exc
        except subprocess.TimeoutExpired as exc:
            temporary.unlink(missing_ok=True)
            raise HTTPException(status_code=500, detail="提取原句音频超时") from exc

    return FileResponse(
        clip_path,
        media_type="audio/wav",
        headers={"Cache-Control": "no-store"},
    )


@app.patch("/api/sentences/{sentence_id}")
def patch_sentence(sentence_id: str, payload: SentencePatch) -> dict[str, Any]:
    text = " ".join(payload.text.split())
    if not text:
        raise HTTPException(status_code=400, detail="句子不能为空")
    with db.get_conn() as conn:
        row = conn.execute("SELECT id FROM sentences WHERE id = ?", (sentence_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="句子不存在")
        conn.execute(
            """
            UPDATE sentences
            SET original_text = COALESCE(original_text, text), text = ?
            WHERE id = ?
            """,
            (text, sentence_id),
        )
    sentence = db.get_sentence(sentence_id)
    if not sentence:
        raise HTTPException(status_code=404, detail="句子不存在")
    return sentence


# ---------------------------------------------------------------- 生词本


@app.get("/api/words")
def list_words() -> list[dict[str, Any]]:
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT w.id, w.lemma, w.phonetic, w.definition, w.translation, w.created_at,
                   rc.state AS review_state, rc.due AS review_due,
                   rc.last_review AS review_last_review,
                   rc.reps AS review_reps, rc.lapses AS review_lapses,
                   rc.introduced_at AS review_introduced_at,
                   o.id AS occurrence_id, o.sentence_id, o.context, o.surface,
                   s.start, s.end, s.material_id, m.title AS material_title
            FROM words w
            LEFT JOIN review_cards rc ON rc.word_id = w.id
            LEFT JOIN word_occurrences o ON o.word_id = w.id
            LEFT JOIN sentences s ON s.id = o.sentence_id
            LEFT JOIN materials m ON m.id = o.material_id
            ORDER BY w.created_at DESC, s.start ASC
            """
        ).fetchall()

    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        word_id = row["id"]
        if word_id not in grouped:
            review_due = row["review_due"]
            grouped[word_id] = {
                "id": word_id,
                "lemma": row["lemma"],
                "phonetic": row["phonetic"],
                "definition": row["definition"],
                "translation": row["translation"],
                "created_at": row["created_at"],
                "review": {
                    "state_name": srs.state_name(
                        row["review_last_review"], row["review_state"] or 1
                    ),
                    "due": review_due,
                    "due_label": srs.next_due_label(review_due) if review_due else None,
                    "reps": row["review_reps"] or 0,
                    "lapses": row["review_lapses"] or 0,
                },
                "occurrences": [],
            }
        if row["occurrence_id"]:
            grouped[word_id]["occurrences"].append(
                {
                    "id": row["occurrence_id"],
                    "sentence_id": row["sentence_id"],
                    "material_id": row["material_id"],
                    "material_title": row["material_title"],
                    "start": row["start"],
                    "end": row["end"],
                    "context": row["context"],
                }
            )
    return list(grouped.values())


class WordCreate(BaseModel):
    word: str
    sentence_id: str | None = None


@app.post("/api/words")
def add_word(payload: WordCreate) -> dict[str, Any]:
    raw = payload.word.strip()
    lemma = re.sub(r"^[^A-Za-z]+|[^A-Za-z]+$", "", raw.lower())
    if not lemma:
        raise HTTPException(status_code=400, detail="不是有效的英文单词")

    info = dictionary.lookup(lemma)
    now = db.now_iso()
    with db.get_conn() as conn:
        existing = conn.execute("SELECT * FROM words WHERE lemma = ?", (lemma,)).fetchone()
        created = existing is None
        if existing:
            word_id = existing["id"]
            conn.execute(
                """
                UPDATE words
                SET phonetic = COALESCE(phonetic, ?),
                    translation = COALESCE(translation, ?),
                    definition = COALESCE(definition, ?)
                WHERE id = ?
                """,
                (info.get("phonetic"), info.get("translation"), info.get("definition"), word_id),
            )
        else:
            word_id = uuid.uuid4().hex
            conn.execute(
                """
                INSERT INTO words (id, lemma, phonetic, definition, translation, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    word_id,
                    lemma,
                    info.get("phonetic"),
                    info.get("definition"),
                    info.get("translation"),
                    now,
                ),
            )

        if payload.sentence_id:
            sentence = conn.execute(
                "SELECT id, material_id, text FROM sentences WHERE id = ?",
                (payload.sentence_id,),
            ).fetchone()
            if not sentence:
                raise HTTPException(status_code=404, detail="原句不存在")
            conn.execute(
                """
                INSERT INTO word_occurrences
                    (id, word_id, sentence_id, material_id, context, surface, note, created_at)
                VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
                ON CONFLICT(word_id, sentence_id) DO UPDATE SET
                    surface = COALESCE(word_occurrences.surface, excluded.surface)
                """,
                (
                    uuid.uuid4().hex,
                    word_id,
                    sentence["id"],
                    sentence["material_id"],
                    sentence["text"],
                    raw[:120],
                    now,
                ),
            )

        conn.execute(
            """
            INSERT OR IGNORE INTO review_cards
                (word_id, state, step, stability, difficulty, due, last_review,
                 introduced_at, reps, lapses, created_at, updated_at)
            VALUES (?, 1, NULL, NULL, NULL, ?, NULL, NULL, 0, 0, ?, ?)
            """,
            (word_id, now, now, now),
        )

        occurrence_count = conn.execute(
            "SELECT COUNT(*) FROM word_occurrences WHERE word_id = ?", (word_id,)
        ).fetchone()[0]

    return {
        "id": word_id,
        "lemma": lemma,
        "created": created,
        "occurrences": occurrence_count,
        "phonetic": info.get("phonetic"),
        "translation": info.get("translation"),
    }


@app.delete("/api/words/{word_id}")
def delete_word(word_id: str) -> dict[str, bool]:
    with db.get_conn() as conn:
        cursor = conn.execute("DELETE FROM words WHERE id = ?", (word_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="生词不存在")
    return {"ok": True}


# ---------------------------------------------------------------- 词典


@app.get("/api/dictionary/{word}")
def lookup_word(word: str) -> dict[str, Any]:
    info = dictionary.lookup(word)
    candidates = {word.lower()}
    if info.get("lemma"):
        candidates.add(str(info["lemma"]).lower())
    placeholders = ",".join("?" for _ in candidates)
    with db.get_conn() as conn:
        row = conn.execute(
            f"SELECT id, lemma FROM words WHERE lemma IN ({placeholders}) LIMIT 1",
            tuple(candidates),
        ).fetchone()
    info["in_wordbook"] = row is not None
    info["word_id"] = row["id"] if row else None
    return info


class DictionaryAttach(BaseModel):
    path: str


@app.post("/api/dictionary/attach")
def attach_dictionary(payload: DictionaryAttach) -> dict[str, Any]:
    try:
        count = dictionary.attach_database(payload.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无法读取词典文件：{exc}") from exc
    return {"entries": count}


# ---------------------------------------------------------------- 设置


def _masked(value: str) -> str | None:
    return f"****{value[-4:]}" if value else None


def _speech_settings() -> dict[str, Any]:
    azure_key = db.get_setting("azure_speech_key", "") or ""
    azure_region = db.get_setting("azure_speech_region", "") or ""
    tencent_app_id = db.get_setting("tencent_speech_app_id", "") or ""
    tencent_secret_id = db.get_setting("tencent_speech_secret_id", "") or ""
    tencent_secret_key = db.get_setting("tencent_speech_secret_key", "") or ""

    azure_configured = bool(azure_key and azure_region)
    tencent_configured = bool(
        tencent_app_id and tencent_secret_id and tencent_secret_key
    )
    # 腾讯云优先；两者都配置时跟读页使用腾讯云。
    provider = (
        "tencent"
        if tencent_configured
        else ("azure" if azure_configured else None)
    )
    return {
        "azure_configured": azure_configured,
        "azure_speech_region": azure_region,
        "azure_key_masked": _masked(azure_key),
        "tencent_configured": tencent_configured,
        "tencent_app_id": tencent_app_id,
        "tencent_secret_id_masked": _masked(tencent_secret_id),
        "tencent_secret_key_masked": _masked(tencent_secret_key),
        "pronunciation_provider": provider,
        "pronunciation_configured": provider is not None,
    }


def _llm_settings() -> dict[str, Any]:
    values = shadow_review.llm_settings()
    return {
        "llm_base_url": values["base_url"],
        "llm_model": values["model"],
        "llm_key_masked": _masked(values["api_key"]),
        "llm_configured": bool(
            values["base_url"] and values["api_key"] and values["model"]
        ),
    }


@app.get("/api/settings")
def get_settings() -> dict[str, Any]:
    return {
        "whisper_model": db.get_setting("whisper_model", "small.en"),
        "daily_new_limit": int(db.get_setting("daily_new_limit", "20") or 20),
        **_speech_settings(),
        **_llm_settings(),
        "models": WHISPER_MODELS,
    }


class SettingsPatch(BaseModel):
    whisper_model: str | None = None
    daily_new_limit: int | None = Field(default=None, ge=0, le=200)
    azure_speech_key: str | None = None
    azure_speech_region: str | None = Field(default=None, max_length=64)
    tencent_speech_app_id: str | None = Field(default=None, max_length=32)
    tencent_speech_secret_id: str | None = Field(default=None, max_length=128)
    tencent_speech_secret_key: str | None = Field(default=None, max_length=128)
    llm_base_url: str | None = Field(default=None, max_length=300)
    llm_api_key: str | None = Field(default=None, max_length=300)
    llm_model: str | None = Field(default=None, max_length=100)


@app.patch("/api/settings")
def patch_settings(payload: SettingsPatch) -> dict[str, Any]:
    if payload.whisper_model is not None:
        if payload.whisper_model not in MODEL_IDS:
            raise HTTPException(status_code=400, detail="不支持的模型")
        current = db.get_setting("whisper_model", "small.en")
        if current != payload.whisper_model:
            db.set_setting("whisper_model", payload.whisper_model)
            jobs.change_model(payload.whisper_model)
    if payload.daily_new_limit is not None:
        db.set_setting("daily_new_limit", str(payload.daily_new_limit))
    if payload.azure_speech_key is not None:
        key = payload.azure_speech_key.strip()
        if key and len(key) < 8:
            raise HTTPException(status_code=400, detail="Azure 密钥看起来不完整")
        db.set_setting("azure_speech_key", key)
    if payload.azure_speech_region is not None:
        region = payload.azure_speech_region.strip().lower()
        if region and not re.fullmatch(r"[a-z0-9-]+", region):
            raise HTTPException(status_code=400, detail="Azure 区域格式不正确，例如 eastus")
        db.set_setting("azure_speech_region", region)
    if payload.tencent_speech_app_id is not None:
        app_id = payload.tencent_speech_app_id.strip()
        if app_id and not re.fullmatch(r"\d{5,20}", app_id):
            raise HTTPException(status_code=400, detail="腾讯云 AppID 应该是纯数字")
        db.set_setting("tencent_speech_app_id", app_id)
    if payload.tencent_speech_secret_id is not None:
        secret_id = payload.tencent_speech_secret_id.strip()
        if secret_id and len(secret_id) < 8:
            raise HTTPException(
                status_code=400, detail="腾讯云 SecretId 看起来不完整"
            )
        db.set_setting("tencent_speech_secret_id", secret_id)
    if payload.tencent_speech_secret_key is not None:
        secret_key = payload.tencent_speech_secret_key.strip()
        if secret_key and len(secret_key) < 8:
            raise HTTPException(
                status_code=400, detail="腾讯云 SecretKey 看起来不完整"
            )
        db.set_setting("tencent_speech_secret_key", secret_key)
    if payload.llm_base_url is not None:
        base_url = payload.llm_base_url.strip()
        if base_url and not re.fullmatch(r"https?://[^\s]+", base_url):
            raise HTTPException(
                status_code=400, detail="AI Base URL 必须以 http:// 或 https:// 开头"
            )
        db.set_setting("llm_base_url", base_url)
    if payload.llm_api_key is not None:
        db.set_setting("llm_api_key", payload.llm_api_key.strip())
    if payload.llm_model is not None:
        db.set_setting("llm_model", payload.llm_model.strip())
    return get_settings()
