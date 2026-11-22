"""Download the ECDICT SQLite dictionary used for offline word lookup."""

from __future__ import annotations

import argparse
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

URL = "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip"


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "Echo/0.1"})
    with urllib.request.urlopen(request, timeout=60) as response:
        total = int(response.headers.get("Content-Length") or 0)
        done = 0
        with destination.open("wb") as handle:
            while True:
                chunk = response.read(1024 * 512)
                if not chunk:
                    break
                handle.write(chunk)
                done += len(chunk)
                if total:
                    percent = done * 100 / total
                    print(
                        f"\r下载词典 {percent:5.1f}%  "
                        f"({done / 1024 / 1024:.0f}/{total / 1024 / 1024:.0f} MB)",
                        end="",
                        flush=True,
                    )
        print()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="覆盖已存在的 data/ecdict.db")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    data_dir = root / "data"
    cache_dir = data_dir / "dict"
    target = data_dir / "ecdict.db"
    archive = cache_dir / "ecdict-sqlite-28.zip"

    data_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    if target.exists() and not args.force:
        print(f"词典已存在：{target}（用 --force 覆盖）")
        return 0

    if not archive.exists():
        print("正在从 GitHub 下载 ECDICT（约 206 MB）…")
        try:
            download(URL, archive)
        except Exception as exc:
            print(f"下载失败：{exc}", file=sys.stderr)
            print("也可以手动下载后解压，把 stardict.db 放到 data/ecdict.db", file=sys.stderr)
            return 1
    else:
        print(f"使用已下载的压缩包：{archive}")

    print("正在解压 stardict.db …")
    with zipfile.ZipFile(archive) as bundle:
        member = next(
            (name for name in bundle.namelist() if name.lower().endswith(".db")),
            None,
        )
        if not member:
            print("压缩包里没有找到 .db 文件", file=sys.stderr)
            return 1
        temporary = target.with_suffix(".db.part")
        with bundle.open(member) as source, temporary.open("wb") as destination:
            shutil.copyfileobj(source, destination)
        temporary.replace(target)

    size_mb = target.stat().st_size / 1024 / 1024
    print(f"完成：{target}（{size_mb:.0f} MB）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
