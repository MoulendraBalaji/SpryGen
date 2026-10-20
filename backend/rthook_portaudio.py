"""PyInstaller runtime hook: make ``sounddevice`` find the bundled PortAudio.

Why this exists
---------------
``sounddevice`` locates PortAudio with ``ctypes.util.find_library('portaudio')``
and only falls back to the copy shipped in the wheel on Windows and macOS:

    for _libname in ('portaudio', 'bin\\libportaudio-2.dll', 'lib/libportaudio.dylib'):
        _libname = _find_library(_libname)
        if _libname is not None:
            break
    else:
        raise OSError('PortAudio library not found')

On Linux that fallback branch simply re-raises, so the *only* way in is
``find_library``. The stock POSIX implementation consults ``ld.so.cache``,
``LD_LIBRARY_PATH`` and a couple of probe directories - it never looks at
``sys._MEIPASS``, where PyInstaller unpacks bundled shared libraries. The result
is that a frozen app which *does* contain ``libportaudio.so.2`` still reports
capture=false, because the library cannot be found by name.

This hook runs before any application code. It restores the bundled library to
the name lookup by returning its absolute path from ``find_library``. It is
deliberately narrow:

  * only the name ``portaudio`` is intercepted;
  * only a library that actually exists inside the bundle is returned;
  * if nothing matches, the original implementation is used unchanged, so a
    system-installed PortAudio still works.

On Windows and macOS the wheel's copy is reached through sounddevice's own
fallback, and PyInstaller already prepends ``sys._MEIPASS`` to the search path,
so this hook is a no-op there.
"""

import os
import sys

try:
    import ctypes.util
except Exception:  # pragma: no cover - ctypes is always present in practice
    pass
else:
    _original_find_library = ctypes.util.find_library

    # Names sounddevice may ask for, in its own order of preference.
    _WANTED = ("portaudio", "libportaudio-2.dll", "libportaudio.dylib")

    def _bundled_candidates(name: str) -> list[str]:
        """Plausible bundle paths for ``name`` (which may already be a path).

        sounddevice asks for the bare name ``portaudio``, but the shared object
        shipped on Linux is ``libportaudio.so.2``, so the ``lib`` prefix and the
        versioned suffixes have to be tried as well.
        """
        base = os.path.basename(name)
        roots = []
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            roots.append(meipass)
            # PyInstaller keeps ``_sounddevice_data`` beside the libraries.
            roots.append(os.path.join(meipass, "_sounddevice_data", "portaudio-binaries"))

        candidates = [name] if os.path.isabs(name) else []
        variants = [base, f"{base}.so", f"{base}.so.2"]
        if not base.startswith("lib"):
            variants += [f"lib{base}.so", f"lib{base}.so.2", f"lib{base}.dylib"]
        for root in roots:
            for variant in variants:
                candidates.append(os.path.join(root, variant))
        return candidates

    def _find_library(name: str):
        if name in _WANTED or os.path.basename(name) in _WANTED:
            for candidate in _bundled_candidates(name):
                if os.path.isfile(candidate):
                    return candidate
        return _original_find_library(name)

    ctypes.util.find_library = _find_library
