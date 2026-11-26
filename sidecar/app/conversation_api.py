from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from . import azure_speech, conversation, llm, tencent_speech, tts
from .shadow_review import llm_configured

router = APIRouter(prefix="/api/conversations", tags=["conversation"])

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


class CreateConversationRequest(BaseModel):
    scenario: str = Field(min_length=1, max_length=40)
    level: str = Field(default="intermediate", max_length=20)
    voice: str = Field(default=tts.DEFAULT_VOICE, max_length=60)


def _extension(content_type: str | None, filename: str | None) -> str:
    base = (content_type or "").split(";")[0].strip().lower()
    if base in MIME_EXTENSIONS:
        return MIME_EXTENSIONS[base]
    suffix = Path(filename or "").suffix.lower()
    if suffix in {".webm", ".ogg", ".oga", ".m4a", ".wav", ".mp3", ".mp4"}:
        return suffix
    return ".webm"


def _media_type(path: Path) -> str:
    suffix = path.suffix.lower()
    return {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
        ".oga": "audio/ogg",
        ".webm": "audio/webm",
    }.get(suffix, "application/octet-stream")


def _map_error(exc: Exception) -> HTTPException:
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, (llm.LLMError, tts.TTSError)):
        return HTTPException(status_code=502, detail=str(exc))
    if isinstance(exc, (tencent_speech.TencentSpeechError, azure_speech.AzureSpeechError)):
        return HTTPException(status_code=502, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc) or "对话服务出错")


@router.get("/scenarios")
def get_scenarios() -> dict[str, Any]:
    return {
        "scenarios": conversation.scenarios(),
        "levels": [
            {"id": key, "label": value.split("：", 1)[0]}
            for key, value in conversation.LEVELS.items()
        ],
        "voices": tts.VOICES,
        "llm_configured": llm_configured(),
    }


@router.get("")
def list_conversations() -> list[dict[str, Any]]:
    return conversation.list_conversations()


@router.post("")
def create_conversation(payload: CreateConversationRequest) -> dict[str, Any]:
    try:
        return conversation.create_conversation(
            payload.scenario, payload.level, payload.voice
        )
    except Exception as exc:
        raise _map_error(exc) from exc


@router.get("/{conversation_id}")
def get_conversation(conversation_id: str) -> dict[str, Any]:
    try:
        return conversation.get_conversation(conversation_id)
    except Exception as exc:
        raise _map_error(exc) from exc


@router.delete("/{conversation_id}")
def delete_conversation(conversation_id: str) -> dict[str, bool]:
    try:
        conversation.delete_conversation(conversation_id)
    except Exception as exc:
        raise _map_error(exc) from exc
    return {"ok": True}


@router.post("/{conversation_id}/turn")
async def submit_turn(
    conversation_id: str,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    content_type = file.content_type or ""
    allowed = (
        not content_type
        or content_type.startswith("audio/")
        or content_type.startswith("video/")
        or content_type == "application/octet-stream"
    )
    if not allowed:
        raise HTTPException(status_code=400, detail="只支持音频录音文件")

    directory = conversation.audio_dir(conversation_id)
    path = directory / f"{uuid.uuid4().hex}{_extension(content_type, file.filename)}"
    size = 0
    try:
        with path.open("wb") as handle:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > 30 * 1024 * 1024:
                    raise HTTPException(status_code=413, detail="录音文件太大")
                handle.write(chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail="录音内容为空")
        try:
            return await run_in_threadpool(
                conversation.submit_turn, conversation_id, path, content_type
            )
        except Exception as exc:
            path.unlink(missing_ok=True)
            raise _map_error(exc) from exc
    except HTTPException:
        path.unlink(missing_ok=True)
        raise
    except Exception:
        path.unlink(missing_ok=True)
        raise


@router.post("/{conversation_id}/hint")
def create_hint(conversation_id: str) -> dict[str, Any]:
    try:
        return conversation.hint(conversation_id)
    except Exception as exc:
        raise _map_error(exc) from exc


@router.post("/{conversation_id}/finish")
def finish_conversation(conversation_id: str) -> dict[str, Any]:
    try:
        return conversation.finish_conversation(conversation_id)
    except Exception as exc:
        raise _map_error(exc) from exc


@router.get("/{conversation_id}/turns/{turn_id}/audio")
def get_turn_audio(conversation_id: str, turn_id: str):
    try:
        path = conversation.speak(conversation_id, turn_id)
    except Exception as exc:
        raise _map_error(exc) from exc
    return FileResponse(
        path,
        media_type=_media_type(path),
        headers={"Cache-Control": "no-store"},
    )


@router.get("/{conversation_id}/tts")
def speak_text(conversation_id: str, text: str = Query(..., min_length=1, max_length=300)):
    try:
        path = conversation.speak_text(conversation_id, text)
    except Exception as exc:
        raise _map_error(exc) from exc
    return FileResponse(
        path,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )


@router.post("/{conversation_id}/drill")
async def drill(
    conversation_id: str,
    ref_text: str = Form(...),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    directory = conversation.audio_dir(conversation_id)
    path = directory / f"{uuid.uuid4().hex}{_extension(file.content_type, file.filename)}"
    size = 0
    try:
        with path.open("wb") as handle:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > 30 * 1024 * 1024:
                    raise HTTPException(status_code=413, detail="录音文件太大")
                handle.write(chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail="录音内容为空")
        try:
            return await run_in_threadpool(
                conversation.score_drill, conversation_id, path, ref_text
            )
        except Exception as exc:
            raise _map_error(exc) from exc
    finally:
        path.unlink(missing_ok=True)
