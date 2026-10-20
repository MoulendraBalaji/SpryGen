import { EventEmitter } from "node:events";
import { exec } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { writeFile, unlink } from "node:fs/promises";
import electronLog from "electron-log";
import { dbLayer } from "../db";
import { profileService } from "../profileService";
import { proxyToPython } from "../pythonClient";
import { VoiceEnrollmentProgress, VoiceState, VoiceStatus } from "../../../shared/types";

// ---------------------------------------------------------------------------
// Typed voice engine errors — propagated straight into the renderer voiceStore.
// ---------------------------------------------------------------------------
export type VoiceErrorCode =
  | "PERMISSION_DENIED"
  | "DEVICE_NOT_FOUND"
  | "RECORDER_TIMEOUT"
  | "ENGINE_FAILURE";

export interface VoiceErrorPayload {
  code: VoiceErrorCode;
  message: string;
  recovered?: boolean;
}

export const enum VoiceErrorMsg {
  PERMISSION_DENIED = "Microphone access is blocked by the operating system.",
  DEVICE_NOT_FOUND = "No audio input device was found.",
  RECORDER_TIMEOUT = "Audio buffer starvation — recorder produced no frames.",
  ENGINE_FAILURE = "The local voice engine is unavailable. Install backend/requirements-voice.txt (or requirements-voice-core.txt for the bundled subset).",
}

// Scoped diagnostic logger — file + console forwarding, never silent.
const log = electronLog.scope("voice-engine");

/**
 * `/api/voice/start` loads the wake-word models synchronously. On the very
 * first run they are downloaded (~10 MB) into the per-user cache, which can
 * take a minute on a slow connection, so allow far more than a typical call.
 */
const VOICE_START_TIMEOUT_MS = 120_000;

interface Voiceprint {
  id: string;
  embedding: number[];
  enrolledAt: number;
  sampleCount: number;
}

interface PythonStatus {
  ok?: boolean;
  running?: boolean;
  components?: Record<string, boolean>;
  missing?: string[];
  wakeModels?: string[];
}

interface PythonEvent {
  type?: string;
  level?: number;
  score?: number;
  text?: string;
  message?: string;
}

/** How often the main process drains wake/transcript events from Python. */
const EVENT_POLL_MS = 300;
/** Number of enrollment samples averaged into the voiceprint. */
const ENROLL_SAMPLES = 5;

/**
 * Thin client over the local Python voice pipeline.
 *
 * All audio capture, wake-word detection, transcription and speaker embeddings
 * happen inside the Python sidecar (`backend/services/voice`). The Electron main
 * process only orchestrates: it persists the enrolled voiceprint in SQLite,
 * forwards events to the renderer, and plays synthesised audio.
 *
 * Every operation fails **closed**: if the Python voice engine or the models are
 * unavailable, speaker verification returns `verified: false` and enrollment
 * refuses to persist a fabricated voiceprint.
 */
class VoiceService extends EventEmitter {
  private state: VoiceState = "idle";
  private isEnrolled = false;
  private isActive = false;
  private similarityThreshold = 0.75;
  private activeVoiceprint: Voiceprint | null = null;
  private eventPollTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.loadEnrolledProfile();
  }

  private loadEnrolledProfile(): void {
    try {
      const row = dbLayer.get("profile", "voiceprint") as { value?: string } | undefined;
      if (row?.value) {
        const parsed = JSON.parse(row.value) as Voiceprint;
        if (Array.isArray(parsed.embedding) && parsed.embedding.length > 0) {
          this.activeVoiceprint = parsed;
          this.isEnrolled = true;
          return;
        }
      }
    } catch (err) {
      log.warn("Could not load the enrolled voiceprint", err);
    }
    this.activeVoiceprint = null;
    this.isEnrolled = false;
  }

  public setState(state: VoiceState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit("state-change", this.state);
  }

  public getState(): VoiceState {
    return this.state;
  }

  private async pythonStatus(): Promise<PythonStatus | null> {
    const res = await proxyToPython<PythonStatus>("/api/voice/status", {}, 4000);
    return res.ok ? res.data : null;
  }

  public async isEngineAvailable(): Promise<boolean> {
    const status = await this.pythonStatus();
    const components = status?.components ?? {};
    // The wake → transcript loop only needs capture + wake + stt. Speaker
    // embeddings are an optional lock and TTS has an OS fallback.
    return Boolean(components.capture && components.wake && components.stt);
  }

  public async getStatus(): Promise<VoiceStatus> {
    const status = await this.pythonStatus();
    const components = status?.components ?? {};
    const missing =
      status?.missing ?? Object.entries(components).filter(([, ready]) => !ready).map(([name]) => name);
    return {
      state: this.state,
      enrolled: this.isEnrolled,
      active: this.isActive,
      speakerSimilarityThreshold: this.similarityThreshold,
      engineAvailable: Boolean(components.capture && components.wake && components.stt),
      components,
      missingComponents: missing,
      wakeModels: Array.isArray(status?.wakeModels) ? status.wakeModels : []
    };
  }

  /** Cosine similarity of two equal-length vectors (never uses randomness). */
  public cosineSimilarity(v1: number[], v2: number[]): number {
    if (v1.length !== v2.length || v1.length === 0) return 0;
    let dot = 0;
    let mag1 = 0;
    let mag2 = 0;
    for (let i = 0; i < v1.length; i++) {
      dot += v1[i] * v2[i];
      mag1 += v1[i] * v1[i];
      mag2 += v2[i] * v2[i];
    }
    return mag1 === 0 || mag2 === 0 ? 0 : dot / (Math.sqrt(mag1) * Math.sqrt(mag2));
  }

  private progress(
    onProgress: ((p: VoiceEnrollmentProgress) => void) | undefined,
    update: VoiceEnrollmentProgress
  ): void {
    if (onProgress) onProgress(update);
    this.emit("enroll-progress", update);
  }

  /**
   * Enroll the speaker. Every sample is a real recording processed by the Python
   * speaker model; the averaged, L2-normalised embedding is persisted in SQLite.
   * If any sample cannot be produced the enrollment fails and nothing is stored.
   */
  public async enroll(onProgress?: (p: VoiceEnrollmentProgress) => void): Promise<boolean> {
    this.setState("enrolling");
    const vectors: number[][] = [];

    for (let sample = 1; sample <= ENROLL_SAMPLES; sample++) {
      this.progress(onProgress, {
        currentSample: sample,
        totalSamples: ENROLL_SAMPLES,
        status: "capturing",
        message: `Speak the enrollment phrase — sample ${sample} of ${ENROLL_SAMPLES}`
      });

      const res = await proxyToPython<{ ok?: boolean; embedding?: number[]; code?: string; message?: string }>(
        "/api/voice/sample",
        { method: "POST", body: JSON.stringify({ seconds: 3 }) },
        30_000
      );
      const embedding = res.ok ? res.data?.embedding : undefined;

      if (!res.ok || !res.data?.ok || !Array.isArray(embedding) || embedding.length === 0) {
        const message = res.ok
          ? res.data?.message ?? "The local speaker model is unavailable."
          : res.message;
        this.progress(onProgress, {
          currentSample: sample,
          totalSamples: ENROLL_SAMPLES,
          status: "failed",
          message
        });
        this.setState("idle");
        return false;
      }
      vectors.push(embedding.map(Number));
    }

    const dimension = vectors[0].length;
    const combined = new Array<number>(dimension).fill(0);
    for (const vector of vectors) {
      for (let i = 0; i < dimension; i++) combined[i] += vector[i] / ENROLL_SAMPLES;
    }
    const norm = Math.sqrt(combined.reduce((sum, value) => sum + value * value, 0));
    const embedding = norm > 0 ? combined.map((value) => value / norm) : combined;

    const voiceprint: Voiceprint = {
      id: dbLayer.genId(),
      embedding,
      enrolledAt: Date.now(),
      sampleCount: ENROLL_SAMPLES
    };
    dbLayer.upsert("profile", {
      id: "voiceprint",
      key: "voiceprint",
      value: JSON.stringify(voiceprint)
    });
    profileService.set({ voiceprintEnrolled: true });
    this.activeVoiceprint = voiceprint;
    this.isEnrolled = true;

    this.progress(onProgress, {
      currentSample: ENROLL_SAMPLES,
      totalSamples: ENROLL_SAMPLES,
      status: "completed",
      message: "Speaker voiceprint enrolled and voice-locked."
    });
    this.setState("idle");
    log.info("Voiceprint enrolled.");
    return true;
  }

  /**
   * Verify the current speaker against the enrolled voiceprint.
   * Fails closed: not enrolled, or the engine is unavailable, yields `false`.
   */
  public async verifySpeaker(): Promise<{ verified: boolean; score: number; reason?: string }> {
    if (!this.isEnrolled || !this.activeVoiceprint) {
      return { verified: false, score: 0, reason: "not_enrolled" };
    }
    const res = await proxyToPython<{
      ok?: boolean;
      verified?: boolean;
      score?: number;
      code?: string;
      message?: string;
    }>(
      "/api/voice/verify",
      {
        method: "POST",
        body: JSON.stringify({
          reference: this.activeVoiceprint.embedding,
          seconds: 3,
          threshold: this.similarityThreshold
        })
      },
      30_000
    );
    if (!res.ok) return { verified: false, score: 0, reason: res.code };
    if (!res.data?.ok) return { verified: false, score: 0, reason: res.data?.code ?? "unavailable" };
    return {
      verified: res.data.verified === true,
      score: typeof res.data.score === "number" ? res.data.score : 0
    };
  }

  /** Start the continuous wake-word loop inside the Python voice engine. */
  public async start(): Promise<{ ok: boolean; error?: VoiceErrorPayload }> {
    if (this.isActive) return { ok: true };
    const reference = this.activeVoiceprint?.embedding ?? [];
    const res = await proxyToPython<{ ok?: boolean; code?: string; message?: string }>(
      "/api/voice/start",
      { method: "POST", body: JSON.stringify({ reference, threshold: this.similarityThreshold }) },
      // Generous: the first start downloads the openWakeWord ONNX models
      // (~10 MB) if they are not cached yet, which can take a minute.
      VOICE_START_TIMEOUT_MS
    );

    if (!res.ok || !res.data?.ok) {
      const message = res.ok ? res.data?.message ?? VoiceErrorMsg.ENGINE_FAILURE : res.message;
      const error: VoiceErrorPayload = { code: "ENGINE_FAILURE", message };
      this.setState("disabled");
      this.emit("voice-error", error);
      log.warn("Python voice engine did not start", message);
      return { ok: false, error };
    }

    this.isActive = true;
    this.setState("idle");
    this.startEventPolling();
    log.info("Wake-word loop started in the Python voice engine.");
    return { ok: true };
  }

  public async stop(): Promise<{ ok: boolean }> {
    this.stopEventPolling();
    this.isActive = false;
    await proxyToPython("/api/voice/stop", { method: "POST" }, 5000);
    this.setState("disabled");
    log.info("Wake-word loop stopped.");
    return { ok: true };
  }

  private startEventPolling(): void {
    if (this.eventPollTimer) return;
    this.eventPollTimer = setInterval(() => {
      void this.pollEvents();
    }, EVENT_POLL_MS);
  }

  private stopEventPolling(): void {
    if (this.eventPollTimer) {
      clearInterval(this.eventPollTimer);
      this.eventPollTimer = null;
    }
  }

  private async pollEvents(): Promise<void> {
    const res = await proxyToPython<{ ok?: boolean; events?: PythonEvent[] }>(
      "/api/voice/events",
      {},
      4000
    );
    if (!res.ok || !Array.isArray(res.data?.events)) return;
    for (const event of res.data.events) this.handleEvent(event);
  }

  private handleEvent(event: PythonEvent): void {
    const type = String(event.type ?? "");
    if (type === "audio-level") {
      this.emit("audio-level", Number(event.level) || 0);
    } else if (type === "wake") {
      this.setState("listening");
      this.emit("wake");
    } else if (type === "denied") {
      this.setState("idle");
      this.emit("unauthorized-voice", Number(event.score) || 0);
    } else if (type === "transcript") {
      this.setState("processing");
      this.emit("transcript", String(event.text ?? ""));
      setTimeout(() => {
        if (this.isActive) this.setState("idle");
      }, 1200);
    } else if (type === "error") {
      log.warn("Voice engine reported an error", event.message);
      this.emit("voice-error", {
        code: "ENGINE_FAILURE",
        message: String(event.message ?? "voice engine error"),
        recovered: true
      });
    }
  }

  /**
   * Manually trigger the wake path (used by the HUD). Speaker verification and
   * transcription are both performed by the Python engine and fail closed.
   */
  public async triggerWake(commandText?: string): Promise<{ authorized: boolean; text?: string }> {
    this.setState("listening");
    this.emit("wake");

    const verification = await this.verifySpeaker();
    if (!verification.verified) {
      this.setState("idle");
      this.emit("unauthorized-voice", verification.score);
      return { authorized: false };
    }

    this.setState("processing");
    let text = commandText;
    if (!text) {
      const res = await proxyToPython<{ ok?: boolean; text?: string }>(
        "/api/voice/transcribe",
        { method: "POST", body: JSON.stringify({ seconds: 5 }) },
        30_000
      );
      text = res.ok && res.data?.ok ? res.data.text ?? "" : "";
    }
    if (text) this.emit("transcript", text);
    setTimeout(() => this.setState("idle"), 1200);
    return { authorized: true, text };
  }

  /**
   * Speak ``text``. Speech is synthesised locally by the Python engine (Kokoro);
   * if that is unavailable we fall back to the OS synthesizer. No network TTS.
   */
  public async speak(text: string): Promise<boolean> {
    if (!text || !text.trim()) return false;
    this.setState("speaking");
    this.emit("speak-start", text);

    const spoke = await this._pythonSpeak(text);
    if (!spoke) await this._nativeSpeak(text);

    this.setState("idle");
    this.emit("speak-end", text);
    return true;
  }

  private async _pythonSpeak(text: string): Promise<boolean> {
    const res = await proxyToPython<{ ok?: boolean; audioBase64?: string }>(
      "/api/voice/tts",
      { method: "POST", body: JSON.stringify({ text }) },
      30_000
    );
    if (!res.ok || !res.data?.ok || typeof res.data.audioBase64 !== "string") return false;

    const filePath = path.join(os.tmpdir(), `sprygen-tts-${Date.now()}.wav`);
    try {
      await writeFile(filePath, Buffer.from(res.data.audioBase64, "base64"));
      await this._playAudioFile(filePath);
      return true;
    } catch (err) {
      log.warn("Local TTS playback failed; falling back to the OS voice", err);
      unlink(filePath).catch(() => undefined);
      return false;
    }
  }

  private _nativeSpeak(text: string): Promise<boolean> {
    return new Promise((resolve) => {
      const clean = text.replace(/["`$\\]/g, " ").slice(0, 300);
      const platform = os.platform();
      let cmd: string;
      if (platform === "win32") {
        cmd = `powershell -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${clean}')"`;
      } else if (platform === "darwin") {
        cmd = `say "${clean}"`;
      } else {
        cmd = `espeak "${clean}" 2>/dev/null || true`;
      }
      exec(cmd, { timeout: 10000 }, () => resolve(true));
    });
  }

  private _playAudioFile(filePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const platform = os.platform();
      let cmd: string;
      if (platform === "win32") {
        const escaped = filePath.replace(/'/g, "''");
        cmd = `powershell -Command "(New-Object Media.SoundPlayer '${escaped}').PlaySync()"`;
      } else if (platform === "darwin") {
        cmd = `afplay "${filePath}"`;
      } else {
        cmd = `aplay "${filePath}" 2>/dev/null || paplay "${filePath}" 2>/dev/null || true`;
      }
      exec(cmd, { timeout: 20000 }, () => {
        unlink(filePath).catch(() => undefined);
        resolve(true);
      });
    });
  }
}

export const voice = new VoiceService();
