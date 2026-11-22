from __future__ import annotations

import json
import subprocess
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from . import azure_speech, config, db, tencent_speech
from .dictation_api import grade_text
from .media import probe_media
from .transcribe import transcribe_short_audio

router = APIRouter(prefix="/api", tags=["recordings"])

MIME_EXTENSIONS = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/oga": ".oga",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mpeg": ".mp3",
    "video/webm": ".webm",
}


def _extension(content_type: str | None, filename: str | None) -> str:
    base = (content_type or "").split(";")[0].strip().lower()
    if base in MIME_EXTENSIONS:
        return MIME_EXTENSIONS[base]
    suffix = Path(filename or "").suffix.lower()
    if suffix in {".webm", ".ogg", ".oga", ".m4a", ".wav", ".mp3", ".mp4"}:
        return suffix
    return ".webm"


def _fallback_duration(path: Path) -> float:
    """MediaRecorder WebM often has no duration in its header."""
    temporary = path.with_name(f"{path.stem}.{uuid.uuid4().hex}.duration.wav")
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(path),
                "-ar",
                "16000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(temporary),
            ],
            check=True,
            timeout=120,
            capture_output=True,
        )
        _media_type, duration = probe_media(temporary)
        return float(duration or 0)
    except Exception:
        return 0.0
    finally:
        temporary.unlink(missing_ok=True)


def _payload(row: Any) -> dict[str, Any]:
    feedback = None
    if row["feedback_json"]:
        try:
            feedback = json.loads(row["feedback_json"])
        except (TypeError, ValueError):
            feedback = None
    pronunciation = None
    if row["azure_json"]:
        try:
            pronunciation = json.loads(row["azure_json"])
        except (TypeError, ValueError):
            pronunciation = None
    if isinstance(pronunciation, dict) and not pronunciation.get("provider"):
        pronunciation["provider"] = "azure"  # results stored before Tencent support
    return {
        "id": row["id"],
        "material_id": row["material_id"],
        "sentence_id": row["sentence_id"],
        "duration": row["duration"],
        "mime_type": row["mime_type"],
        "created_at": row["created_at"],
        "recognized_text": row["recognized_text"],
        "accuracy": row["accuracy"],
        "feedback": feedback,
        # `azure` is kept as an alias so older builds still render the result.
        "pronunciation": pronunciation,
        "azure": pronunciation,
    }


def _convert_to_wav(source: Path) -> Path:
    if config.settings is None:
        raise RuntimeError("数据目录未初始化")
    destination = (
        config.settings.recordings_dir
        / f"{source.stem}.{uuid.uuid4().hex}.16k.wav"
    )
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            str(destination),
        ],
        check=True,
        timeout=120,
        capture_output=True,
    )
    return destination


@router.get("/recordings")
def list_recordings(sentence_id: str) -> list[dict[str, Any]]:
    with db.get_conn() as conn:
        rows = conn.execute(
            """
            SELECT * FROM recordings
            WHERE sentence_id = ?
            ORDER BY created_at DESC
            """,
            (sentence_id,),
        ).fetchall()
    return [_payload(row) for row in rows]


@router.post("/recordings")
async def upload_recording(
    material_id: str = Form(...),
    sentence_id: str = Form(...),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    sentence = db.get_sentence(sentence_id)
    if not sentence:
        raise HTTPException(status_code=404, detail="原句不存在")
    if sentence["material_id"] != material_id:
        raise HTTPException(status_code=400, detail="原句不属于这个素材")
    if not db.get_material(material_id):
        raise HTTPException(status_code=404, detail="素材不存在")
    if config.settings is None:
        raise HTTPException(status_code=500, detail="数据目录未初始化")

    content_type = file.content_type or ""
    allowed = (
        not content_type
        or content_type.startswith("audio/")
        or content_type.startswith("video/")
        or content_type == "application/octet-stream"
    )
    if not allowed:
        raise HTTPException(status_code=400, detail="只支持音频录音文件")

    recording_id = uuid.uuid4().hex
    suffix = _extension(content_type, file.filename)
    path = config.settings.recordings_dir / f"{recording_id}{suffix}"
    size = 0
    try:
        with path.open("wb") as handle:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > 60 * 1024 * 1024:
                    raise HTTPException(status_code=413, detail="录音文件太大")
                handle.write(chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail="录音内容为空")

        _media_type, duration = probe_media(path)
        if not duration:
            duration = _fallback_duration(path)
        now = db.now_iso()
        with db.get_conn() as conn:
            conn.execute(
                """
                INSERT INTO recordings
                    (id, material_id, sentence_id, file_path, mime_type, duration,
                     recognized_text, accuracy, feedback_json, created_at, transcribed_at)
                VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL)
                """,
                (
                    recording_id,
                    material_id,
                    sentence_id,
                    str(path.resolve()),
                    content_type or "audio/webm",
                    duration or 0,
                    now,
                ),
            )
            row = conn.execute(
                "SELECT * FROM recordings WHERE id = ?", (recording_id,)
            ).fetchone()
    except Exception:
        path.unlink(missing_ok=True)
        raise

    return _payload(row)


@router.get("/recordings/{recording_id}/audio")
def get_recording_audio(recording_id: str):
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM recordings WHERE id = ?", (recording_id,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="录音不存在")
    path = Path(row["file_path"])
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="录音文件不存在")
    return FileResponse(
        path,
        media_type=row["mime_type"] or "audio/webm",
        headers={"Accept-Ranges": "bytes", "Cache-Control": "no-store"},
    )


@router.delete("/recordings/{recording_id}")
def delete_recording(recording_id: str) -> dict[str, bool]:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM recordings WHERE id = ?", (recording_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="录音不存在")
        conn.execute("DELETE FROM recordings WHERE id = ?", (recording_id,))
    Path(row["file_path"]).unlink(missing_ok=True)
    return {"ok": True}


@router.post("/recordings/{recording_id}/analyze")
def analyze_recording(recording_id: str) -> dict[str, Any]:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM recordings WHERE id = ?", (recording_id,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="录音不存在")

    sentence = db.get_sentence(row["sentence_id"])
    if not sentence:
        raise HTTPException(status_code=404, detail="原句已经不存在，无法评测")
    source = Path(row["file_path"])
    if not source.exists():
        raise HTTPException(status_code=404, detail="录音文件不存在")

    if config.settings is None:
        raise HTTPException(status_code=500, detail="数据目录未初始化")
    analysis_path: Path | None = None
    try:
        analysis_path = _convert_to_wav(source)
        recognized = transcribe_short_audio(str(analysis_path))
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", "replace")[:300] if exc.stderr else "转码失败"
        raise HTTPException(status_code=500, detail=f"录音转码失败：{detail}") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=500, detail="录音处理超时") from exc
    finally:
        if analysis_path is not None:
            analysis_path.unlink(missing_ok=True)

    grade = grade_text(sentence["text"], recognized)
    target_duration = max(
        float(sentence["end"]) - float(sentence["start"]), 0.1
    )
    recording_duration = float(row["duration"] or 0)
    rate_ratio = (
        target_duration / recording_duration if recording_duration > 0 else 0
    )
    feedback = {
        **grade,
        "recognized_text": recognized,
        "target_duration": round(target_duration, 3),
        "recording_duration": round(recording_duration, 3),
        "rate_ratio": round(rate_ratio, 3),
    }
    now = db.now_iso()
    with db.get_conn() as conn:
        conn.execute(
            """
            UPDATE recordings
            SET recognized_text = ?, accuracy = ?, feedback_json = ?,
                transcribed_at = ?
            WHERE id = ?
            """,
            (
                recognized,
                grade["accuracy"],
                json.dumps(feedback, ensure_ascii=False),
                now,
                recording_id,
            ),
        )
    return feedback


def _speech_credentials() -> tuple[str, dict[str, str]]:
    """Pick the configured provider: Tencent first, then Azure."""
    app_id = db.get_setting("tencent_speech_app_id", "") or ""
    secret_id = db.get_setting("tencent_speech_secret_id", "") or ""
    secret_key = db.get_setting("tencent_speech_secret_key", "") or ""
    if app_id and secret_id and secret_key:
        return (
            "tencent",
            {
                "app_id": app_id,
                "secret_id": secret_id,
                "secret_key": secret_key,
            },
        )

    azure_key = db.get_setting("azure_speech_key", "") or ""
    azure_region = db.get_setting("azure_speech_region", "") or ""
    if azure_key and azure_region:
        return "azure", {"key": azure_key, "region": azure_region}

    raise HTTPException(
        status_code=400,
        detail="请先在设置页配置腾讯云智聆或 Azure 的评测凭据",
    )


@router.post("/recordings/{recording_id}/pronunciation-score")
def score_recording(recording_id: str) -> dict[str, Any]:
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM recordings WHERE id = ?", (recording_id,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="录音不存在")

    provider, credentials = _speech_credentials()
    max_seconds = (
        tencent_speech.MAX_AUDIO_SECONDS
        if provider == "tencent"
        else azure_speech.MAX_AUDIO_SECONDS
    )

    sentence = db.get_sentence(row["sentence_id"])
    if not sentence:
        raise HTTPException(status_code=404, detail="原句已经不存在，无法评分")

    duration = float(row["duration"] or 0)
    if duration > max_seconds + 0.5:
        raise HTTPException(
            status_code=400,
            detail=f"发音评估最长支持 {max_seconds} 秒，请录制更短的片段",
        )

    source = Path(row["file_path"])
    if not source.exists():
        raise HTTPException(status_code=404, detail="录音文件不存在")

    wav_path: Path | None = None
    try:
        wav_path = _convert_to_wav(source)
        if provider == "tencent":
            result = tencent_speech.score_wav(
                wav_path,
                sentence["text"],
                credentials["app_id"],
                credentials["secret_id"],
                credentials["secret_key"],
            )
        else:
            result = azure_speech.score_wav(
                wav_path,
                sentence["text"],
                credentials["key"],
                credentials["region"],
            )
            result["provider"] = "azure"
    except (azure_speech.AzureSpeechError, tencent_speech.TencentSpeechError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", "replace")[:300] if exc.stderr else "转码失败"
        raise HTTPException(status_code=500, detail=f"录音转码失败：{detail}") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=500, detail="录音转码超时") from exc
    finally:
        if wav_path is not None:
            wav_path.unlink(missing_ok=True)

    with db.get_conn() as conn:
        conn.execute(
            """
            UPDATE recordings
            SET azure_json = ?, azure_scored_at = ?
            WHERE id = ?
            """,
            (
                json.dumps(result, ensure_ascii=False),
                result["scored_at"],
                recording_id,
            ),
        )
    return result


@router.post("/recordings/{recording_id}/azure-score")
def score_recording_with_azure(recording_id: str) -> dict[str, Any]:
    """Backward-compatible alias for older renderer builds."""
    return score_recording(recording_id)
