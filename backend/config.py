import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

OLLAMA_URL = os.getenv("SPRYGEN_OLLAMA_URL") or "http://127.0.0.1:11434"
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
SERVER_HOST = os.getenv("SPRYGEN_HOST", "127.0.0.1")
SERVER_PORT = int(os.getenv("SPRYGEN_PORT", "8766"))
