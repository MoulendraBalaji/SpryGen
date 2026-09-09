import React, { useEffect, useState } from "react";
import { ClayCard, ClayButton, ClayInput, ClayToggle, ClayBadge } from "../design-system";
import { useProfile } from "../store/profile";
import { useVoice } from "../store/voice";
import { sprygen } from "../lib/sprygen";
import { DeviceSyncStatus, VoiceEnrollmentProgress, VoiceStatus } from "../../shared/types";

export function ProfileSettings() {
  const { profile, load, set, deleteFact } = useProfile();
  const voice = useVoice();
  const [style, setStyle] = useState("");
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null);
  const [syncStatus, setSyncStatus] = useState<DeviceSyncStatus | null>(null);
  const [enrollProgress, setEnrollProgress] = useState<VoiceEnrollmentProgress | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    load();
    voice.load();
    loadVoiceAndSync();

    const unsubVoice = sprygen.onEvent("voice:enroll-progress", (p: VoiceEnrollmentProgress) => {
      setEnrollProgress(p);
      if (p.status === "completed" || p.status === "failed") {
        setEnrolling(false);
        loadVoiceAndSync();
      }
    });

    const unsubSync = sprygen.onEvent("sync:paired", () => {
      loadVoiceAndSync();
    });

    return () => {
      unsubVoice();
      unsubSync();
    };
  }, [load]);

  useEffect(() => {
    if (profile) setStyle(profile.phrasingStyle);
  }, [profile]);

  const loadVoiceAndSync = async () => {
    try {
      const vs = await sprygen.voice.getStatus();
      setVoiceStatus(vs);
      const ss = await sprygen.sync.getStatus();
      setSyncStatus(ss);
    } catch {
      /* ignore */
    }
  };

  const handleEnrollVoice = async () => {
    setEnrolling(true);
    setEnrollProgress({
      currentSample: 0,
      totalSamples: 8,
      status: "capturing",
      message: "Starting voice enrollment. Speak 'Hey SPRYGEN' clearly..."
    });
    try {
      await sprygen.voice.enroll();
    } catch {
      setEnrolling(false);
    }
  };

  const handleRegenerateCode = async () => {
    try {
      const code = await sprygen.sync.regenerateCode();
      if (syncStatus) setSyncStatus({ ...syncStatus, pairingCode: code });
    } catch {
      /* ignore */
    }
  };

  if (!profile) return <ClayCard>Loading profile…</ClayCard>;

  const pct = enrollProgress && enrollProgress.totalSamples > 0
    ? Math.min(100, (enrollProgress.currentSample / enrollProgress.totalSamples) * 100)
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ClayCard large eyebrow="09 · Profile & Preferences">
        <p className="console-meta" style={{ margin: "0 0 14px" }}>
          Everything SPRYGEN has learned — fully editable and transparent.
        </p>

        <label className="console-meta" style={{ display: "block", marginBottom: 6 }}>
          Phrasing style
        </label>
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <ClayInput value={style} onChange={(e) => setStyle(e.target.value)} />
          <ClayButton variant="primary" onClick={() => set({ phrasingStyle: style })}>Save</ClayButton>
        </div>

        <div className="console-row" style={{ justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 12 }}>Active hours</div>
            <div className="console-meta">
              {profile.activeHours.start}:00 – {profile.activeHours.end}:00 ·
              notifications suppressed outside these hours
            </div>
          </div>
          <ClayToggle
            on={false}
            onChange={() => void 0}
            aria-label="Active hours read-only"
            style={{ opacity: 0.5, cursor: "default" }}
          />
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, marginBottom: 8 }}>Learned facts & memory</div>
          {profile.learnedFacts.length === 0 && (
            <span className="console-meta">No facts learned yet. Say "remember that…" to store memories.</span>
          )}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {profile.learnedFacts.map((f) => (
              <div key={f.key} className="console-row" style={{ justifyContent: "space-between" }}>
                <span style={{ fontSize: 13 }}>
                  <strong>{f.key}</strong>: {f.value}
                </span>
                <button className="console-delete" onClick={() => deleteFact(f.key)} aria-label={`Delete ${f.key}`}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </ClayCard>

      <ClayCard large eyebrow="10 · Voice & Audio">
        <div className="console-row" style={{ justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 12 }}>Voice-Lock & Speaker Verification</div>
            <div className="console-meta">Eagle acoustic voiceprint. Rejects unauthorized voices.</div>
          </div>
          <ClayBadge status={voiceStatus?.enrolled ? "healthy" : "unauthenticated"}>
            {voiceStatus?.enrolled ? "Voice-Locked" : "Not Enrolled"}
          </ClayBadge>
        </div>

        {enrollProgress && (
          <div className="console-pre" style={{ marginTop: 12, padding: "10px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
              <span>{enrollProgress.message}</span>
              <strong>sample {enrollProgress.currentSample}/{enrollProgress.totalSamples}</strong>
            </div>
            <div style={{ height: 4, background: "var(--console-surface-3)", position: "relative", overflow: "hidden" }}>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "var(--console-accent)",
                  transform: `scaleX(${pct / 100})`,
                  transformOrigin: "left",
                  transition: "transform 150ms ease-out"
                }}
              />
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <ClayButton variant="primary" onClick={handleEnrollVoice} disabled={enrolling}>
            {enrolling ? "Capturing Voice…" : voiceStatus?.enrolled ? "Re-enroll Voiceprint" : "Enroll Voiceprint"}
          </ClayButton>
          <ClayButton variant="ghost" onClick={() => sprygen.voice.speak("SPRYGEN voice synthesizer online and ready.")}>
            Test Speech (TTS)
          </ClayButton>
        </div>

        <div className="console-row" style={{ marginTop: 16, justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 12 }}>Automatic listening (wake word)</div>
            <div className="console-meta">
              state: {voice.status?.state ?? "…"}
              {voice.status?.accessKeyConfigured ? "" : " · no Picovoice key, simulated"}
            </div>
          </div>
          <ClayToggle
            on={voice.listening}
            onChange={() => voice.setListening(!voice.listening)}
            aria-label="Toggle automatic voice listening"
          />
        </div>
        <p className="console-meta" style={{ margin: "8px 0 0" }}>
          Loop on → SPRYGEN listens continuously for its wake word. Loop off → listening is
          fully manual.
        </p>
      </ClayCard>

      <ClayCard large eyebrow="11 · Companion & Sync">
        <div className="console-row" style={{ justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 12 }}>Phone Companion & Local LAN Sync</div>
            <div className="console-meta">Pair the React Native Expo companion app to mirror notifications and captures.</div>
          </div>
          <ClayBadge status={syncStatus?.paired ? "healthy" : "unauthenticated"}>
            {syncStatus?.paired ? "Paired" : "Awaiting Pairing"}
          </ClayBadge>
        </div>

        <div className="console-pre" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 14 }}>
          <div>
            <div className="console-meta" style={{ fontSize: 9, letterSpacing: 2 }}>6-DIGIT PAIRING PIN</div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: 5, color: "var(--console-accent-dim)" }}>
              {syncStatus?.pairingCode || "------"}
            </div>
          </div>
          <div className="console-meta" style={{ flex: 1 }}>
            Enter this PIN in the companion app while on the same Wi-Fi. Port: {syncStatus?.serverPort || 8765}
          </div>
          <ClayButton variant="ghost" onClick={handleRegenerateCode}>New PIN</ClayButton>
        </div>
      </ClayCard>
    </div>
  );
}