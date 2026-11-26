from __future__ import annotations

import asyncio
import hashlib
import threading
import uuid
from pathlib import Path

from . import config


class TTSError(RuntimeError):
    pass


VOICES = [
    {
        "id": "en-US-AriaNeural",
        "label": "Aria · 美音女声",
        "note": "自然、亲和，适合日常对话",
    },
    {
        "id": "en-US-GuyNeural",
        "label": "Guy · 美音男声",
        "note": "沉稳、清晰，适合面试和职场",
    },
    {
        "id": "en-GB-SoniaNeural",
        "label": "Sonia · 英音女声",
        "note": "英式发音，适合 IELTS 练习",
    },
]
DEFAULT_VOICE = VOICES[0]["id"]
MAX_TEXT_LENGTH = 800

_lock = threading.Lock()


def voice_ids() -> list[str]:
    return [voice["id"] for voice in VOICES]


def _cache_dir() -> Path:
    if config.settings is None:
        raise TTSError("数据目录未初始化")
    directory = config.settings.data_dir / "tts-cache"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


async def _save(text: str, voice: str, rate: str, path: Path) -> None:
    import edge_tts

    communicate = edge_tts.Communicate(text, voice, rate=rate)
    await communicate.save(str(path))


def synthesize(text: str, voice: str | None = None, rate: str = "+0%") -> Path:
    """Render text to an MP3 with Microsoft Edge neural voices.

    Results are cached by text/voice/rate so replaying a message is instant.
    """
    content = (text or "").strip()
    if not content:
        raise TTSError("没有可以朗读的文本")
    if len(content) > MAX_TEXT_LENGTH:
        content = content[:MAX_TEXT_LENGTH]
    if voice not in voice_ids():
        voice = DEFAULT_VOICE
    if rate not in {"-20%", "-10%", "+0%", "+10%"}:
        rate = "+0%"

    cache = _cache_dir()
    key = hashlib.sha1(f"{voice}|{rate}|{content}".encode("utf-8")).hexdigest()
    target = cache / f"{key}.mp3"
    if target.exists() and target.stat().st_size > 0:
        return target

    with _lock:
        if target.exists() and target.stat().st_size > 0:
            return target
        temporary = cache / f"{key}.{uuid.uuid4().hex}.part.mp3"
        try:
            asyncio.run(asyncio.wait_for(_save(content, voice, rate, temporary), timeout=45))
        except Exception as exc:
            temporary.unlink(missing_ok=True)
            raise TTSError(
                "语音合成失败，请检查网络连接（AI 音色需要联网）"
            ) from exc
        if not temporary.exists() or temporary.stat().st_size == 0:
            temporary.unlink(missing_ok=True)
            raise TTSError("语音合成没有返回音频，请稍后重试")
        temporary.replace(target)
    return target
