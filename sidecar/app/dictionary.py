from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path
from typing import Any

from . import config

_count_cache: int | None = None
_table_cache: str | None = None


def reset_cache() -> None:
    global _count_cache, _table_cache
    _count_cache = None
    _table_cache = None


def _open_db() -> sqlite3.Connection | None:
    if config.settings is None or not config.settings.ecdict_path.exists():
        return None
    uri = config.settings.ecdict_path.resolve().as_uri() + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def _table_name(conn: sqlite3.Connection) -> str | None:
    global _table_cache
    if _table_cache:
        return _table_cache
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    names = {row[0] for row in rows}
    if "stardict" in names:
        _table_cache = "stardict"
    elif "ecdict" in names:
        _table_cache = "ecdict"
    return _table_cache


def entry_count() -> int:
    global _count_cache
    if _count_cache is not None:
        return _count_cache
    try:
        conn = _open_db()
        if conn is None:
            _count_cache = 0
            return 0
        try:
            table = _table_name(conn)
            if not table:
                _count_cache = 0
                return 0
            _count_cache = int(conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
        finally:
            conn.close()
    except Exception:
        _count_cache = 0
    return _count_cache or 0


def _candidates(word: str) -> list[str]:
    w = word.lower().strip()
    if not w:
        return []
    results = [w]

    def add(value: str) -> None:
        if value and value not in results:
            results.append(value)

    if w.endswith("'s") or w.endswith("’s"):
        add(w[:-2])
    if w.endswith("ies") and len(w) > 4:
        add(w[:-3] + "y")
    if w.endswith("ied") and len(w) > 4:
        add(w[:-3] + "y")
    if w.endswith("es") and len(w) > 3:
        add(w[:-2])
    if w.endswith("s") and not w.endswith("ss") and len(w) > 2:
        add(w[:-1])
    if w.endswith("ed") and len(w) > 3:
        add(w[:-2])
        add(w[:-1])
    if w.endswith("ing") and len(w) > 4:
        add(w[:-3])
        add(w[:-3] + "e")
    if w.endswith("er") and len(w) > 3:
        add(w[:-2])
        add(w[:-1])
    if w.endswith("est") and len(w) > 4:
        add(w[:-3])
        add(w[:-2])
    if w.endswith("ly") and len(w) > 3:
        add(w[:-2])
    return results


def lookup(word: str) -> dict[str, Any]:
    normalized = word.strip()
    base = {
        "found": False,
        "word": normalized,
        "lemma": normalized.lower(),
        "phonetic": None,
        "translation": None,
        "definition": None,
        "source": None,
    }
    try:
        conn = _open_db()
        if conn is None:
            return base
        try:
            table = _table_name(conn)
            if not table:
                return base
            columns = {
                row[1]
                for row in conn.execute(f'PRAGMA table_info("{table}")').fetchall()
            }
            wanted = [c for c in ("word", "phonetic", "translation", "definition") if c in columns]
            select = ", ".join(f'"{c}"' for c in wanted)
            for candidate in _candidates(normalized):
                row = conn.execute(
                    f'SELECT {select} FROM "{table}" WHERE word = ? COLLATE NOCASE LIMIT 1',
                    (candidate,),
                ).fetchone()
                if row:
                    data = dict(row)
                    return {
                        "found": bool(data.get("translation") or data.get("definition")),
                        "word": normalized,
                        "lemma": data.get("word") or candidate,
                        "phonetic": data.get("phonetic"),
                        "translation": data.get("translation"),
                        "definition": data.get("definition"),
                        "source": "ECDICT",
                    }
        finally:
            conn.close()
    except Exception:
        return base
    return base


def attach_database(source_path: str | Path) -> int:
    if config.settings is None:
        raise RuntimeError("settings is not initialised")
    source = Path(source_path).expanduser().resolve()
    if not source.exists() or not source.is_file():
        raise ValueError("文件不存在")
    if source.suffix.lower() in {".zip", ".7z", ".rar"}:
        raise ValueError("请先解压，选择其中的 ecdict.db 文件")

    # 先验证它确实是一个可用的 ECDICT 数据库，再复制。
    uri = source.as_uri() + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=10)
    try:
        names = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
        }
        if "stardict" not in names and "ecdict" not in names:
            raise ValueError("这个数据库里没有 ECDICT 词表")
        first_table = "stardict" if "stardict" in names else "ecdict"
        count = int(conn.execute(f'SELECT COUNT(*) FROM "{first_table}"').fetchone()[0])
    finally:
        conn.close()

    target = config.settings.ecdict_path
    if source != target:
        shutil.copy2(source, target)
    reset_cache()
    return count
