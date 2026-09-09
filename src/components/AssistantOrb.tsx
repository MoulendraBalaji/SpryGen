import React from "react";
import "./orb.css";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const BAR_HEIGHTS = [0.4, 0.7, 1, 0.85, 0.55, 0.3, 0.45, 0.75, 1, 0.9, 0.6, 0.35];

export function AssistantOrb({
  state = "idle",
  size = 96,
  onActivate
}: {
  state?: OrbState;
  size?: number;
  onActivate?: () => void;
}) {
  const ticks = Array.from({ length: 48 }, (_, i) => i);
  return (
    <div
      className={`console-orb console-orb--${state}`}
      style={{ width: size, height: size }}
      onClick={onActivate}
      role="button"
      aria-label="SPRYGEN assistant dial"
      title="SPRYGEN"
    >
      <svg className="console-orb__ring" viewBox="0 0 100 100" aria-hidden="true">
        {ticks.map((i) => (
          <line
            key={i}
            className={`console-orb__tick ${i % 8 === 0 ? "console-orb__tick--major" : ""}`}
            x1="50"
            y1="4"
            x2="50"
            y2={i % 8 === 0 ? "10" : "7"}
            transform={`rotate(${i * 7.5} 50 50)`}
          />
        ))}
      </svg>
      <div className="console-orb__bars" aria-hidden="true">
        {BAR_HEIGHTS.map((h, i) => (
          <i
            key={i}
            className="console-orb__bar"
            style={{ height: `${h * 100}%`, ["--i" as string]: i } as React.CSSProperties}
          />
        ))}
      </div>
      <span className="console-orb__core" />
    </div>
  );
}