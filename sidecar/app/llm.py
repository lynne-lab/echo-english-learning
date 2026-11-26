from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Any


class LLMError(RuntimeError):
    pass


def endpoint_for(base_url: str) -> str:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        raise LLMError("请先在设置页填写 AI 服务的 Base URL")
    if not base.startswith(("http://", "https://")):
        raise LLMError("AI 服务的 Base URL 必须以 http:// 或 https:// 开头")
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def _error_message(body: str) -> str:
    try:
        data = json.loads(body)
    except (TypeError, ValueError):
        return body.strip()[:300] or "未知错误"
    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])[:300]
        if isinstance(error, str) and error.strip():
            return error.strip()[:300]
        for key in ("message", "msg", "detail"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()[:300]
    return json.dumps(data, ensure_ascii=False)[:300]


def _strip_fences(text: str) -> str:
    result = text.strip()
    match = re.fullmatch(r"```(?:markdown|md)?\s*\n(.*?)\n```", result, re.S)
    if match:
        return match.group(1).strip()
    return result


def chat(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    max_tokens: int = 2000,
    temperature: float = 0.35,
    timeout: float = 180.0,
    response_format: dict[str, Any] | None = None,
) -> str:
    if not api_key:
        raise LLMError("请先在设置页填写 AI 服务的 API Key")
    if not model:
        raise LLMError("请先在设置页填写模型名称")

    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if response_format:
        payload["response_format"] = response_format
    request = urllib.request.Request(
        endpoint_for(base_url),
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "Echo-Shadow-Review/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        raise LLMError(
            f"AI 服务返回 HTTP {exc.code}：{_error_message(body)}"
        ) from exc
    except urllib.error.URLError as exc:
        raise LLMError(
            f"无法连接 AI 服务（{exc.reason}），请检查网络和 Base URL"
        ) from exc
    except TimeoutError as exc:
        raise LLMError("AI 服务响应超时，请稍后重试或换一个模型") from exc

    try:
        data: Any = json.loads(raw)
        content = data["choices"][0]["message"]["content"]
    except (TypeError, ValueError, KeyError, IndexError) as exc:
        raise LLMError("AI 服务返回了无法解析的结果") from exc

    if not isinstance(content, str) or not content.strip():
        raise LLMError("AI 服务没有返回报告内容")
    return _strip_fences(content)
