# 🌀 SPRYGEN — Voice-Commanded, Automation-Ready AI Desktop Assistant

<p align="center">
  <img src="https://img.shields.io/badge/Electron-31.x-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-18.x-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-5.x-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Expo-51.x-000020?style=for-the-badge&logo=expo&logoColor=white" alt="Expo" />
  <img src="https://img.shields.io/badge/SQLite-WAL_Mode-003B57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License" />
</p>

---

## 🌟 Overview

**SPRYGEN** is a local-first, biometric-commanded personal desktop assistant engineered with **Electron, React 18, TypeScript, and a tactical Opera GX + Arc Reactor design system**. It pairs real browser/desktop automation (Selenium, PyAutoGUI, BeautifulSoup) with a keyless hybrid Groq/Cerebras/OpenRouter/Mistral/Ollama LLM chain, a fully-local offline voice pipeline, semantic memory, and local-first storage — all while running silent and unobtrusive during gaming or deep-work sessions.

---

## ⚡ Key Highlights

### 🎙️ 1. Voice-Commanded Biometric Access
* **Wake Word (openWakeWord)**: fully offline wake-phrase listener — no access key, no cloud.
* **Local Speaker Verification (Resemblyzer)**: enrollment records real audio, computes a 256-dimensional speaker embedding, and stores the averaged voiceprint locally. A cosine-similarity comparison against a fresh recording forms the speaker lock. If the local models are missing the lock **fails closed** (nothing is ever verified).
* **Privacy-First**: audio capture, speaker embeddings, transcription (faster-whisper) and speech synthesis (Kokoro) all run on your machine. No raw audio ever leaves your computer.
* **Local TTS with native fallback**: Kokoro renders replies offline; the OS synthesizer steps in automatically only if the local engine is unavailable.
* ⚠️ **The speaker lock is not a strong security boundary.** It can be fooled by a recording (replay attack) or a synthetic/cloned copy of your voice, so treat it as a convenience gate, not authentication for sensitive data.

### 🪟 2. Invisible Overlay & Smart Distraction Shield
* **Global Hotkey Summon**: Press `CmdOrCtrl + Shift + Space` (or `Alt + J`) to instantly bring up the floating assistant overlay.
* **DND & Fullscreen Suppression**: Automatically detects fullscreen games, videos, or scheduled quiet hours. Intrusive notifications are buffered in a local backlog queue and delivered when you return.
* **System Tray Resident**: Quick menu actions for toggling listening, opening settings, or running quick captures.

### 🔌 3. Multi-Source Ingest Adapters
* 💬 **WhatsApp Web Extraction**: Intelligent text parsing for homework announcements and assignment deadlines.
* 📱 **Mobile Notification Mirror**: Real-time WebSocket connection to mirror mobile alerts from Android/iOS.
* 📋 **Global Clipboard Quick Capture (`CmdOrCtrl + Shift + J`)**: Highlight text anywhere on your OS to automatically extract dates and actions via `chrono-node`.
* 🩺 **Integrations Health Monitor**: Live telemetry displaying connection status and one-click re-authorization for all wired services.

### 🤖 4. Automation Engine & Agent Capabilities
* **Browser Automation (Selenium + BeautifulSoup)**: Multi-step browser tasks (navigate, click, type, extract, screenshot) with an operator **Kill Switch**, plus a dedicated **Web Scraper** panel.
* **Web Scraping is a native agent tool**: ask the assistant to "scrape/summarize/analyze `<url>`" and SPRYGEN fetches the page, extracts clean text, and reasons over it with the LLM.
* **Desktop Actions (PyAutoGUI)**: Screenshot, type, hotkeys, bounded mouse moves and clicks — all running with `FAILSAFE=True` and an abort flag.
* **Hybrid LLM routing**: Groq → Cerebras → OpenRouter → Mistral → local Ollama → deterministic fast-path rules. Providers without a key are skipped; a keyless install runs entirely on Ollama.

### 🧠 5. Hybrid NLP & Encrypted Persistent Memory
* **Multi-Tiered Query Engine**:
  1. Instant regex entity extraction and natural language date parsing (`chrono-node`).
  2. Anchored fast-path rules for explicit commands (`remind me to …`, `todo: …`, `remember that …`).
  3. Free-tier cloud LLMs (Groq, Cerebras, OpenRouter, Mistral) for complex reasoning.
  4. Local Ollama LLM for offline/privacy-sensitive prompts.
* **Privacy gate**: prompts classified as personal (memory, passwords, schedules, screen/voice payloads) are forced onto a local provider and never sent to a cloud model.
* **Local RAG Vector Store**: 64-dimensional semantic text embeddings with cosine search for instant recall of facts, notes, and past tasks.

### 📱 6. Mobile Companion App
* Built on **React Native (Expo 51)**.
* Fast local LAN pairing over port `8765` using secure 6-digit PIN handshake.
* On-device notification listener and mobile task capture.

### 🎨 7. Opera GX + Arc Reactor Design System
* Frameless **Opera GX** titlebar, tactical monospace dark shell, keyboard-first command palette (`Ctrl+K`), and a multi-ring **Arc Reactor HUD** that surfaces engine state (`idle`, `listening`, `processing`, `automating`, `error`).

---

## ✅ Implemented vs. Planned

Everything below is implemented in this repository and covered by the automated
acceptance suite; anything not listed is **not** claimed.

| Area | Status |
| --- | --- |
| Electron + React desktop shell, Arc Reactor HUD, command palette, overlay/DND | ✅ Implemented |
| SQLite (better-sqlite3) as the single datastore; in-memory emergency fallback | ✅ Implemented |
| Stateless Python FastAPI sidecar (`/api/chat` → `{answer, intent, actions}`) | ✅ Implemented |
| Keyless provider chain (Groq/Cerebras/OpenRouter/Mistral → Ollama) with cooldowns, `Retry-After`, privacy gate | ✅ Implemented |
| Anchored fast-path + LLM tool-calling; side-effecting actions require UI confirmation | ✅ Implemented |
| Per-launch token, random port, Host/Origin checks, SSRF guards, single-flight automation, ESC kill switch | ✅ Implemented |
| LAN sync server: `/status` (no secrets), `/pair` per-device token, `/capture`, 64 KB body cap, PIN lockout | ✅ Implemented |
| Local voice pipeline (openWakeWord, faster-whisper, Resemblyzer, Kokoro) with fail-closed speaker lock | ✅ Implemented (optional ML deps) |
| Screen understanding via `desktopCapturer` + local Ollama vision | ✅ Implemented |
| Expo companion app (pairing, quick capture, notification relay) | ✅ Implemented |
| Cross-platform installers / notarized macOS builds | ⚠️ Partially verified — CI builds on Windows/Linux; macOS packaging is configured but not exercised in CI |
| Multi-user accounts / cloud sync / mobile push | ❌ Not planned |

---

## 🏗️ System Architecture

```mermaid
flowchart TB
    subgraph Mobile["📱 Mobile Companion (Expo / React Native)"]
        MC_UI[Quick Capture UI]
        MC_Notif[Notification Listener]
        MC_WS[LAN WebSocket Client]
    end

    subgraph Desktop["💻 SPRYGEN Desktop (Electron + Vite)"]
        subgraph Core["Main Process & Background Services"]
            Voice[🎙️ Local Voice Engine (Python sidecar)]
            Overlay[🪟 Overlay & DND Manager]
            Router[🧠 Hybrid NLP Router]
            Python[🐍 Python FastAPI Backend]
            Auto[🤖 Automation Engine]
            SyncServer[📡 Sync Server :8765]
            DB[(🗄️ SQLite / JSON Store)]
        end

        subgraph Adapters["Ingest Adapters"]
            WA[WhatsApp Web]
            Mirror[Notification Mirror]
            Manual[Clipboard Capture]
        end

        subgraph Renderer["🎨 UI Renderer (React 18 + Opera GX)"]
            HUD[Arc Reactor HUD]
            Briefing[Daily Briefing]
            Board[Task Board]
            Chat[Interactive Chat]
            Health[Integrations Health]
            Automation[Automation Panel]
        end
    end

    MC_Notif --> MC_WS
    MC_UI --> MC_WS
    MC_WS <-->|LAN Sync & Pairing| SyncServer

    Adapters --> DB
    Core <-->|IPC Bridge| Renderer
    Core <--> Python
    Python --> Auto
```

---

## 🚀 Getting Started

### Prerequisites
* **Node.js**: v18.0.0 or higher (v20+ recommended)
* **npm**: v9.0.0 or higher
* **Git**

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/MoulendraBalaji/SpryGen.git
cd SpryGen

# Install Desktop dependencies
npm install

# Install Mobile Companion dependencies
cd companion-app
npm install
cd ..
```

---

### 2. Development Mode

```bash
# Start the Desktop app with Hot Reloading (Vite + Electron)
npm run dev
```

To run the Mobile Companion app:
```bash
cd companion-app
npm run start
```

---

### 3. Production Build & Packaging

```bash
# Check TypeScript types
npm run typecheck

# Build Desktop production bundle
npm run build

# Package standalone installers
npm run package:win     # Windows (.exe installer & portable)
npm run package:mac     # macOS (.dmg / .zip)
npm run package:linux   # Linux (.AppImage / .deb)
```

Packaged installers and executables will be generated in the `release/` directory.

---

## ⌨️ Global Hotkeys

| Shortcut | Action | Scope |
| :--- | :--- | :--- |
| `CmdOrCtrl + Shift + Space` | Summon / Hide SPRYGEN Overlay | System-wide |
| `Alt + J` | Alternative Toggle Overlay | System-wide |
| `CmdOrCtrl + Shift + J` | Quick Capture Selected Text to Task | System-wide |

---

## ⚙️ Environment Configuration

Create a `.env` file in the root directory (see [`.env.example`](file:///.env.example)):

```env
# AI & LLM Services (all optional — SPRYGEN runs fully offline via Ollama)
GROQ_API_KEY=""                     # Groq (free tier) - fast cloud fallback
CEREBRAS_API_KEY=""                 # Cerebras (free tier)
OPENROUTER_API_KEY=""               # OpenRouter (use :free models)
MISTRAL_API_KEY=""                  # Mistral (free tier)
SPRYGEN_OLLAMA_URL="http://127.0.0.1:11434" # Local Ollama endpoint (no key)

# Local voice pipeline (optional, no API keys - see backend/requirements-voice.txt)
# SPRYGEN_WAKE_MODEL=""             # Path to a custom openWakeWord model (.onnx); blank = bundled default
# SPRYGEN_WHISPER_MODEL="base.en"   # faster-whisper model size
# SPRYGEN_TTS_VOICE="af_heart"      # Kokoro voice
# SPRYGEN_VISION_MODEL="llava"      # Ollama vision model for screen understanding

# Device Sync Server
SPRYGEN_SYNC_PORT=8765              # WebSocket sync port for mobile companion app
```

### Free providers

You do **not** need any API key: with every key blank, SPRYGEN runs fully offline
against a local [Ollama](https://ollama.com/) server. The optional cloud
providers all have free tiers at the time of writing:

| Provider | Free tier | Notes |
| --- | --- | --- |
| Groq | Yes | Fast inference; rate-limited free tier. |
| Cerebras | Yes | Free tier; rate-limited. |
| OpenRouter | Yes | Use the `:free` model variants. |
| Mistral | Yes | Free experimentation tier. |
| Ollama | N/A (local) | No key, no account, works offline. |

> Free tiers, model names and rate limits change often — check each provider's
> pricing page before relying on them. Provider/model configuration lives in
> `backend/providers.json`; no code change is needed to update a model name.

---

## 🧪 Tests & Acceptance

Every phase has an automated check. Run the whole suite with one command:

```bash
# Linux / macOS (Git Bash on Windows)
bash scripts/acceptance.sh

# Windows (PowerShell)
./scripts/acceptance.ps1
```

The script runs, in order, and prints `PASS`/`FAIL` for phases 1–8:

1. `npm run typecheck` — typed IPC surface / datastore
2. `npm run build` — shared schemas + renderer/main bundles
3. `pytest backend/tests` — routing, provider fallback, trust boundary, SSRF,
   sync-server security, voice/vision fail-closed
4. `npm run test` — Vitest (stores, health panel, bridge error screen)
5. `npm run test:e2e` — Playwright `_electron` smoke test (starts the real app
   against a mock OpenAI-compatible model, creates a task, restarts, verifies
   SQLite persistence)

CI runs the same acceptance script on `ubuntu-latest` and `windows-latest` for
every push and pull request (`.github/workflows/ci.yml`). Release builds depend
on that workflow passing.

---

## 📁 Repository Structure

```
SpryGen/
├── electron/                   # Electron Main & Preload Processes
│   ├── ipc/                    # Type-Safe IPC Channel Registrations
│   ├── services/               # Background Services & Ingest Adapters
│   │   ├── adapters/           # WhatsApp, Notification Ingest
│   │   ├── voice/              # Thin client over the local Python voice engine
│   │   ├── db.ts               # SQLite (better-sqlite3) + in-memory emergency fallback
│   │   ├── deviceSync.ts       # LAN pairing + capture server
│   │   ├── overlay.ts          # Window State Machine & DND Manager
│   │   └── pythonClient.ts     # Typed proxy to the Python sidecar
│   ├── main.ts                 # Main Process Entry Point
│   └── preload.ts              # CommonJS Context Bridge Preload
├── src/                        # React 18 Renderer Process
│   ├── components/             # Opera GX Shell, HUD, Panels
│   ├── design-system/          # Clay Tokens, Buttons, Inputs, Cards
│   ├── lib/                    # Typed bridge access (no mock/fake fallback)
│   ├── store/                  # Zustand Global State Stores
│   ├── App.tsx                 # Core Dashboard Shell
│   └── main.tsx                # React Mount with Error Boundary
├── backend/                    # Python FastAPI, stateless sidecar
│   ├── agents/                 # Chat / Task / Memory / Briefing agents
│   ├── llm/                    # Intent router + provider chain
│   ├── services/automation/    # Selenium + PyAutoGUI + BeautifulSoup
│   ├── services/voice/         # Local voice pipeline (fail-closed)
│   ├── services/vision.py      # Screen → local Ollama vision
│   └── server.py               # FastAPI app (dynamic port + launch token)
├── companion-app/              # React Native (Expo) Mobile Companion
├── shared/                     # Shared TypeScript types + zod IPC schemas
├── tests/                      # Vitest unit tests + Playwright e2e
├── scripts/                    # Acceptance runners + security check helper
├── electron-builder.yml        # Multi-Platform Packaging Specs
├── electron.vite.config.ts     # Electron-Vite Bundler Configuration
├── tsconfig.json               # Root TypeScript Configuration
└── package.json                # Project Manifest
```

---

## 🛡️ Privacy & Security

* **Local Storage**: All tasks, history, notes, and biometric embeddings are saved in a local SQLite database on your device.
* **Biometric Protection**: Speaker voiceprints are stored as numeric vectors without retaining raw audio files.
* **Not authentication**: the speaker lock is a convenience gate. It can be fooled by a replay recording or a synthetic/cloned voice, so do not use it to protect secrets on a shared machine. When the local models are missing it fails closed (nothing is verified).
* **Local LAN Communication**: Device synchronization between your desktop and mobile companion runs over your local network with per-device tokens issued by a PIN handshake. `/status` on the LAN never exposes the pairing code or tokens.
* **Prompt privacy**: personal-data and screen/voice prompts are forced onto a local provider; only non-personal prompts may use a configured cloud provider.

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

<p align="center">
  Crafted by <b>Moulendra Balaji</b>
</p>
