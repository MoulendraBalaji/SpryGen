# Third-Party Software & Licenses

SPRYGEN bundles or depends on the components below. This file lists the
upstream project and its license so the obligations of each are visible. All
license identifiers refer to the license used by the upstream project at the
time of writing; always confirm against the pinned version if you redistribute.

SPRYGEN itself is released under the MIT License (see [`LICENSE`](./LICENSE)).

## Desktop / renderer (npm)

| Package | License |
| --- | --- |
| electron | MIT |
| electron-builder | MIT |
| electron-vite | MIT |
| vite | MIT |
| react, react-dom | MIT |
| react-native / expo (companion app) | MIT |
| zustand | MIT |
| lucide-react | ISC |
| chrono-node | MIT |
| node-cron | MIT |
| electron-log | MIT |
| ws | MIT |
| better-sqlite3 | MIT |
| keytar | MIT |
| tailwindcss / @tailwindcss/typography | MIT |
| autoprefixer | MIT |
| postcss | MIT |
| @vitejs/plugin-react | MIT |
| typescript | Apache-2.0 |

## Test & CI tooling (dev dependencies)

| Package | License |
| --- | --- |
| vitest, @vitest/coverage-v8 | MIT |
| jsdom | MIT |
| @testing-library/react, jest-dom, user-event | MIT |
| @playwright/test (Playwright) | Apache-2.0 |
| pytest, pytest-asyncio, pytest-cov | MIT |
| esbuild (used by the sync security check) | MIT |

## Python backend

| Package | License |
| --- | --- |
| fastapi | MIT |
| uvicorn | BSD-3-Clause |
| pydantic | MIT |
| httpx | BSD-3-Clause |
| selenium | Apache-2.0 |
| webdriver-manager | Apache-2.0 |
| beautifulsoup4 | MIT |
| pyautogui | BSD-3-Clause |
| pygetwindow | BSD-3-Clause |
| requests | Apache-2.0 |
| python-dotenv | BSD-3-Clause |
| websockets | BSD-3-Clause |

## Local voice pipeline (optional — `backend/requirements-voice.txt`)

| Component | License | Notes |
| --- | --- | --- |
| [sounddevice](https://github.com/spatialaudio/python-sounddevice) | MIT | Microphone capture (PortAudio). |
| [NumPy](https://numpy.org/) | BSD-3-Clause | Audio buffers / array maths. |
| [openWakeWord](https://github.com/dscripka/openWakeWord) | Apache-2.0 | Offline wake-word detection. |
| openWakeWord pretrained models | Apache-2.0 | Downloaded on first use unless a local model is supplied. |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | MIT | Local speech-to-text (CTranslate2 backend). |
| OpenAI Whisper weights | MIT | Downloaded on first run. |
| [Resemblyzer](https://github.com/resemble-ai/Resemblyzer) | Apache-2.0 | Speaker embeddings for the voice lock. |
| [Kokoro](https://github.com/hexgrad/kokoro) | Apache-2.0 | Local neural text-to-speech. |
| [PyTorch](https://pytorch.org/) | BSD-3-Clause | Runtime for the speaker/TTS models. |
| [CTranslate2](https://github.com/OpenNMT/CTranslate2) | MIT | faster-whisper inference backend. |
| [soundfile](https://github.com/bastibe/python-soundfile) / libsndfile | BSD-3-Clause / LGPL-2.1 | WAV writing (Kokoro output). |
| [Ollama](https://github.com/ollama/ollama) | MIT | Local LLM/vision server used for chat and screen understanding. |

## Automation (Python)

| Package | License |
| --- | --- |
| Selenium | Apache-2.0 |
| BeautifulSoup4 | MIT |
| PyAutoGUI | BSD-3-Clause |
| PyGetWindow | BSD-3-Clause |

## Speech synthesis voices & model weights

Model weights are downloaded at runtime and are **not** distributed with this
repository. Their licenses are governed by the upstream projects (openWakeWord,
OpenAI Whisper, Resemblyzer, Kokoro). Review those before commercial
redistribution; some community voice packs may carry different terms than the
base model.
