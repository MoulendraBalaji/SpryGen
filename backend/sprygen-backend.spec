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
# PyInstaller follow their module graphs statically.
#
# PortAudio (needed by sounddevice) is handled by PyInstaller's own
# ``hook-sounddevice``: the Windows/macOS wheels bundle the library under
# ``_sounddevice_data`` and the hook collects it, while on Linux there is no
# bundled copy and the *build host* must provide it (``libportaudio2``,
# see .github/workflows/release.yml). Without it the hook logs
# "portaudio shared library not found" and the packaged app reports
# capture=false, so we fail the build here instead of shipping a mute app.
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


def _portaudio_available() -> bool:
    """Whether a PortAudio library can be found on this build host."""
    import ctypes.util

    try:
        import _sounddevice_data  # noqa: F401

        data_dir = os.path.join(next(iter(_sounddevice_data.__path__)), "portaudio-binaries")
        if any(name.startswith("libportaudio") for name in os.listdir(data_dir)):
            return True
    except Exception:  # noqa: BLE001 - fall through to the system probe
        pass
    return ctypes.util.find_library("portaudio") is not None


if "sounddevice" in hiddenimports:
    if _portaudio_available():
        print("spec: PortAudio found — audio capture will be bundled")
    elif os.environ.get("SPRYGEN_ALLOW_VOICE_WITHOUT_PORTAUDIO", "0") == "1":
        print(
            "spec: WARNING - PortAudio is unavailable on this build host, so the "
            "packaged app will not be able to capture audio.\n"
            "spec: Linux: sudo apt-get install -y libportaudio2   "
            "(Windows/macOS wheels bundle it)."
        )
    else:
        raise SystemExit(
            "spec: ERROR - PortAudio is unavailable on this build host, so the "
            "packaged app would report capture=false and the microphone would "
            "never open.\n"
            "spec: Linux: sudo apt-get install -y libportaudio2   "
            "(Windows/macOS wheels bundle it).\n"
            "spec: Set SPRYGEN_ALLOW_VOICE_WITHOUT_PORTAUDIO=1 to build anyway."
        )

# ---------------------------------------------------------------------------
# PortAudio name lookup inside the frozen app.
#
# sounddevice finds PortAudio purely through ``ctypes.util.find_library`` on
# Linux, and the stock implementation never looks in ``sys._MEIPASS`` (where
# bundled shared libraries live), so a frozen app that contains
# ``libportaudio.so.2`` would still report capture=false. ``rthook_portaudio``
# runs before application code and teaches find_library about the bundled copy,
# without disturbing system lookups. It is a no-op on Windows/macOS, where
# sounddevice's own fallback and PyInstaller's search-path prepend already work.
# ---------------------------------------------------------------------------
runtime_hooks = [os.path.join(SPECPATH, "rthook_portaudio.py")]

a = Analysis(
    ["sidecar.py"],
    pathex=[os.path.abspath(".")],
    binaries=[],
    datas=voice_datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=runtime_hooks,
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
