import { sprygen } from "./sprygen";
import { useChat } from "../store/chat";
import { useVoice } from "../store/voice";

/**
 * The speech-to-speech loop.
 *
 * The Python voice engine does wake-word detection, speaker verification and
 * transcription, and forwards every recognised command to the renderer as a
 * `voice:transcript` event. This module closes the loop by:
 *
 *   1. sending the transcript through the normal chat pipeline (so tasks,
 *      memories and automation actions are applied exactly like typed input),
 *   2. speaking the assistant's answer back through local TTS (Kokoro, with an
 *      OS-synthesizer fallback).
 *
 * Returns an unsubscribe function. Speech output is best-effort: a TTS failure
 * never breaks the chat turn, and it can be turned off with the
 * `speakReplies` preference in Settings.
 */
export function wireVoiceLoop(): () => void {
  return sprygen.onEvent("voice:transcript", (raw: unknown) => {
    const command = String(raw ?? "").trim();
    if (!command) return;

    void (async () => {
      const result = await useChat.getState().send(command);
      const answer = result?.answer?.trim();
      if (!answer || !useVoice.getState().speakReplies) return;
      try {
        await sprygen.voice.speak(answer);
      } catch {
        /* TTS is best-effort; the answer is still shown in the transcript. */
      }
    })();
  });
}
