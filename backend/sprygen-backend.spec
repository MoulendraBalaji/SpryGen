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

from PyInstaller.utils.hooks import collect_submodules

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

a = Analysis(
    ["backend/sidecar.py"],
    pathex=[os.path.abspath(".")],
    binaries=[],
    datas=[],
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
