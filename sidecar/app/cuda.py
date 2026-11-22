from __future__ import annotations

import os
import sys
from pathlib import Path


def add_cuda_dll_directories() -> list[str]:
    """Make NVIDIA DLLs discoverable for ctranslate2 on Windows.

    In development they come from the pip `nvidia` namespace packages. In the
    PyInstaller build they are copied next to the sidecar executable.
    """
    added: list[str] = []
    roots: list[Path] = []

    if getattr(sys, "frozen", False):
        roots.append(Path(sys.executable).resolve().parent / "nvidia")

    try:
        import nvidia

        roots.extend(Path(path) for path in getattr(nvidia, "__path__", []))
    except Exception:
        pass

    seen: set[Path] = set()
    for root in roots:
        if not root.is_dir() or root in seen:
            continue
        seen.add(root)
        for component in ("cublas", "cudnn", "cuda_runtime", "cuda_nvrtc"):
            for sub in ("bin", "lib"):
                directory = root / component / sub
                if not directory.is_dir():
                    continue
                try:
                    os.add_dll_directory(str(directory))
                except (AttributeError, OSError):
                    pass
                os.environ["PATH"] = str(directory) + os.pathsep + os.environ.get("PATH", "")
                added.append(str(directory))
    return added
