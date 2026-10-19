"""PyInstaller entry point for the packaged SPRYGEN Python sidecar.

In packaged builds Electron spawns this frozen executable instead of
``python -m uvicorn``. All configuration (host, port, launch token) arrives
exclusively through the environment that Electron sets per launch, so the
sidecar never needs to read a config file or a datastore.
"""

from backend.server import run_server

if __name__ == "__main__":
    run_server()
