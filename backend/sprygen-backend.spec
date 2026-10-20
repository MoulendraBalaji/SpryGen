# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the SPRYGEN Python sidecar.

Build from the repository root:

    pyinstaller backend/sprygen-backend.spec --noconfirm \
        --distpath backend/dist --workpath backend/build

Output: ``backend/dist/sprygen-backend`` (``.exe`` on Windows). Electron copies
this into ``resources/backend/dist`` via ``electron-builder.yml`` and spawns it
in packaged builds.
"""

import os

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

# uvicorn imports its loop / protocol implementations dynamically, so they must
# be declared explicitly for the frozen build.
hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "dotenv",
] + collect_submodules("backend")

# ---------------------------------------------------------------------------
# Optional offline voice stack (PyTorch-free subset).
#
# The voice pipeline imports numpy / sounddevice / openwakeword / faster-whisper
# lazily via ``__import__``, which PyInstaller cannot discover by itself — the
# packaged app would otherwise report every component as missing and the mic
# toggle would fail with ENGINE_FAILURE. Listing them as hidden imports makes
# PyInstaller follow their module graphs statically; the data files (e.g.
# sounddevice's bundled PortAudio binaries) are collected explicitly.
#
# Every package here is optional at build time: if it is not installed in the
# build environment the build still succeeds and the component is simply
# reported as missing at runtime.
# ---------------------------------------------------------------------------
VOICE_PACKAGES = ("numpy", "sounddevice", "openwakeword", "faster_whisper")
hiddenimports += list(VOICE_PACKAGES)

voice_datas = []
for _pkg in VOICE_PACKAGES:
    try:
        voice_datas += collect_data_files(_pkg)
    except Exception as _exc:  # not installed in this environment
        print(f"spec: no data files for {_pkg}: {_exc}")

a = Analysis(
    ["sidecar.py"],
    pathex=[os.path.abspath(".")],
    binaries=[],
    datas=voice_datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="sprygen-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
