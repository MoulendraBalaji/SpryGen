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

**SPRYGEN** is a local-first, biometric-commanded personal desktop assistant engineered with **Electron, React 18, TypeScript, and a tactical Opera GX + Arc Reactor design system**. It pairs real browser/desktop automation (Selenium, PyAutoGUI, BeautifulSoup) with hybrid Groq/Gemini/Ollama LLMs, ElevenLabs voice output, semantic memory, and optional encrypted PostgreSQL persistence — all while running silent and unobtrusive during gaming or deep-work sessions.

---

## ⚡ Key Highlights

### 🎙️ 1. Voice-Commanded Biometric Access
* **Porcupine Wake Word**: Ultra low-power wake phrase listener (*"Hey SPRYGEN"*).
* **Eagle Acoustic Voiceprint Verification**: Biometric speaker enrollment (8-sample acoustic voiceprint profile). Rejects unauthorized voices using cosine similarity scoring.
* **Privacy-First**: Audio analysis and voiceprints are computed and persisted locally. No raw audio ever leaves your computer.
* **ElevenLabs TTS (with native fallback)**: ElevenLabs voice synthesis renders every assistant reply with a natural voice; the OS synthesizer steps in automatically if the key is missing or the API is unreachable.

### 🪟 2. Invisible Overlay & Smart Distraction Shield
* **Global Hotkey Summon**: Press `CmdOrCtrl + Shift + Space` (or `Alt + J`) to instantly bring up the floating assistant overlay.
* **DND & Fullscreen Suppression**: Automatically detects fullscreen games, videos, or scheduled quiet hours. Intrusive notifications are buffered in a local backlog queue and delivered when you return.
* **System Tray Resident**: Quick menu actions for toggling listening, opening settings, or running quick captures.

### 🔌 3. Multi-Source Ingest Adapters
* 💬 **WhatsApp Web Extraction**: Intelligent text parsing for homework announcements and assignment deadlines.
* 📱 **Mobile Notification Mirror**: Real-time WebSocket connection to mirror mobile alerts from Android/iOS.
* 📋 **Global Clipboard Quick Capture (`CmdOrCtrl + Shift + J`)**: Highlight text anywhere on your OS to automatically extract dates and actions via `chrono-node`.
* 🩺 **Integrations Health Monitor**: Live telemetry displaying connection status, sync history, and one-click re-authorization. Includes a **postgres dropdown health monitor** telling you whether encrypted Postgres persistence is active.

### 🤖 4. Automation Engine & Agent Capabilities
* **Browser Automation (Selenium + BeautifulSoup)**: Multi-step browser tasks (navigate, click, type, extract, screenshot) with an operator **Kill Switch**, plus a dedicated **Web Scraper** panel.
* **Web Scraping is a native agent tool**: ask the assistant to "scrape/summarize/analyze `<url>`" and SPRYGEN fetches the page, extracts clean text, and reasons over it with the LLM.
* **Desktop Actions (PyAutoGUI)**: Screenshot, type, hotkeys, bounded mouse moves and clicks — all running with `FAILSAFE=True` and an abort flag.
* **Hybrid LLM routing**: Groq → Gemini → local Ollama → deterministic fast-path rules.

### 🧠 5. Hybrid NLP & Encrypted Persistent Memory
* **Multi-Tiered Query Engine**:
  1. Instant regex entity extraction and natural language date parsing (`chrono-node`).
  2. Prototype semantic matching for instant system controls.
  3. Cloud LLMs (Groq, Gemini) for complex reasoning.
  4. Local Ollama LLM for offline privacy.
* **Local RAG Vector Store**: 64-dimensional semantic text embeddings with cosine search for instant recall of facts, notes, and past tasks.
* **Optional Encrypted PostgreSQL**: point `SPRYGEN_DATABASE_URL` at a Postgres instance and all app tables (tasks, chat, profile, memory) are mirrored **AES-256-GCM encrypted**. Without it, SPRYGEN transparently falls back to its local store.

### 📱 6. Mobile Companion App
* Built on **React Native (Expo 51)**.
* Fast local LAN pairing over port `8765` using secure 6-digit PIN handshake.
* On-device notification listener and mobile task capture.

### 🎨 7. Opera GX + Arc Reactor Design System
* Frameless **Opera GX** titlebar, tactical monospace dark shell, keyboard-first command palette (`Ctrl+K`), and a multi-ring **Arc Reactor HUD** that surfaces engine state (`idle`, `listening`, `processing`, `automating`, `error`).

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
            Voice[🎙️ Voice Engine + ElevenLabs TTS]
            Overlay[🪟 Overlay & DND Manager]
            Router[🧠 Hybrid NLP Router]
            Python[🐍 Python FastAPI Backend]
            Auto[🤖 Automation Engine]
            SyncServer[📡 Sync Server :8765]
            DB[(🗄️ SQLite / JSON Store)]
            PG[(🗄️ Optional Encrypted Postgres)]
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
git clone https://github.com/MoulendraBalaji/Jarvis_Assistant.git
cd Jarvis_Assistant

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
# AI & LLM Endpoints
GEMINI_API_KEY=your_gemini_api_key_here         # optional
GROQ_API_KEY=your_groq_api_key_here             # fast cloud LLM routing
ELEVENLABS_API_KEY=your_elevenlabs_api_key       # voice TTS
SPRYGEN_OLLAMA_URL=http://127.0.0.1:11434

# Voice & Biometrics (Picovoice Porcupine / Eagle)
PICOVOICE_ACCESS_KEY=your_picovoice_access_key

# Device Sync
SPRYGEN_SYNC_PORT=8765

# Optional encrypted PostgreSQL persistence
# SPRYGEN_DATABASE_URL=postgres://user:pass@host:5432/sprygen
# SPRYGEN_DB_ENCRYPTION_KEY=your_32+_char_encryption_passphrase
```

---

## 📁 Repository Structure

```
Sprygen_Assistant/
├── electron/                   # Electron Main & Preload Processes
│   ├── ipc/                    # Type-Safe IPC Channel Registrations
│   ├── services/               # Background Services & Ingest Adapters
│   │   ├── adapters/           # WhatsApp, Notification Ingest
│   │   ├── automation/         # (backend) Selenium / PyAutoGUI suite
│   │   ├── voice/              # Porcupine & Eagle Voice Engines
│   │   ├── db.ts               # SQLite / JSON Fallback Database
│   │   ├── postgres.ts         # Optional AES-256-GCM encrypted mirror
│   │   ├── encryption.ts       # AES-256-GCM primitives
│   │   ├── overlay.ts          # Window State Machine & DND Manager
│   │   └── router.ts           # Hybrid NLP Intent Classifier
│   ├── main.ts                 # Main Process Entry Point
│   └── preload.ts              # CommonJS Context Bridge Preload
├── src/                        # React 18 Renderer Process
│   ├── components/             # Opera GX Shell, HUD, Panels
│   ├── design-system/          # Clay Tokens, Buttons, Inputs, Cards
│   ├── lib/                    # Client IPC Proxies & API Fallbacks
│   ├── store/                  # Zustand Global State Stores
│   ├── App.tsx                 # Core Dashboard Shell
│   └── main.tsx                # React Mount with Error Boundary
├── backend/                    # Python FastAPI multi-agent backend
│   ├── agents/                 # Chat / Task / Memory / Briefing agents
│   ├── services/automation/    # Selenium + PyAutoGUI + BeautifulSoup
│   └── server.py               # FastAPI app (port 8766)
├── companion-app/              # React Native (Expo) Mobile Companion
├── shared/                     # Shared TypeScript Interfaces & Types
├── electron-builder.yml        # Multi-Platform Packaging Specs
├── electron.vite.config.ts     # Electron-Vite Bundler Configuration
├── tsconfig.json               # Root TypeScript Configuration
└── package.json                # Project Manifest
```

---

## 🛡️ Privacy & Security

* **100% Local Storage**: All tasks, history, notes, and biometric embeddings are saved directly on your device.
* **Biometric Protection**: Speaker voiceprints are stored as numeric vectors without retaining raw audio files.
* **Optional Encrypted Postgres**: When enabled, everything is mirrored into PostgreSQL encrypted with **AES-256-GCM** (`SPRYGEN_DB_ENCRYPTION_KEY`). Records stay unreadable at rest without the key.
* **Local LAN Communication**: Device synchronization between your desktop and mobile companion runs strictly over your local Wi-Fi network with PIN pairing.

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

<p align="center">
  Crafted by <b>Moulendra Balaji</b>
</p>
