// src/components/hud/ArcReactorHUD.tsx
import React from 'react';

export type HUDState = 'idle' | 'listening' | 'processing' | 'automating' | 'error';

interface ArcReactorHUDProps {
  state: HUDState;
  decibels?: number;
  size?: number;
}

export const ArcReactorHUD: React.FC<ArcReactorHUDProps> = ({ state = 'idle', decibels = 0.2, size = 380 }) => {
  const getSpeedClass = () => {
    switch (state) {
      case 'listening':
        return 'animate-[spin_4s_linear_infinite]';
      case 'processing':
      case 'automating':
        return 'animate-[spin_1.5s_linear_infinite]';
      case 'error':
        return 'animate-none';
      default:
        return 'animate-[spin_20s_linear_infinite]';
    }
  };

  const centerScale = state === 'listening' ? 1 + decibels * 0.25 : 1;

  return (
    <div className="relative flex items-center justify-center select-none" style={{ width: size, height: size }}>
      <svg viewBox="0 0 500 500" className="w-full h-full filter drop-shadow-[0_0_12px_rgba(255,255,255,0.18)]">
        <g className={`${getSpeedClass()} origin-center`} style={{ transformOrigin: '250px 250px' }}>
          <circle cx="250" cy="250" r="230" stroke="#FFFFFF" strokeWidth="1.2" fill="none" strokeDasharray="3 9" opacity="0.45" />
          <circle cx="250" cy="250" r="218" stroke="#FFFFFF" strokeWidth="2" fill="none" strokeDasharray="40 180 60 70" opacity="0.8" />
          <circle cx="250" cy="250" r="208" stroke="#FFFFFF" strokeWidth="1" fill="none" strokeDasharray="2 6" opacity="0.3" />
        </g>

        <g className="animate-[spin_12s_linear_infinite_reverse] origin-center" style={{ transformOrigin: '250px 250px' }}>
          <circle cx="250" cy="250" r="190" stroke="#FFFFFF" strokeWidth="2.5" fill="none" strokeDasharray="120 40 80 60 20 80" opacity="0.9" />
          <circle cx="250" cy="250" r="176" stroke="#FFFFFF" strokeWidth="1" fill="none" strokeDasharray="5 15" opacity="0.4" />
          <circle cx="250" cy="250" r="165" stroke="#FFFFFF" strokeWidth="1.5" fill="none" strokeDasharray="8 8" opacity="0.6" />
        </g>

        <g className={`${getSpeedClass()} origin-center`} style={{ transformOrigin: '250px 250px' }}>
          <circle cx="250" cy="250" r="145" stroke="#FFFFFF" strokeWidth="3" fill="none" strokeDasharray="90 12 30 12" opacity="0.85" />
          <circle cx="250" cy="250" r="132" stroke="#FFFFFF" strokeWidth="1" fill="none" strokeDasharray="4 4" opacity="0.5" />
          <circle cx="250" cy="250" r="120" stroke="#FFFFFF" strokeWidth="2" fill="none" strokeDasharray="180 180" opacity="0.75" />
        </g>

        <g className="animate-[spin_6s_linear_infinite_reverse] origin-center" style={{ transformOrigin: '250px 250px' }}>
          <circle cx="250" cy="250" r="95" stroke="#FFFFFF" strokeWidth="2" fill="none" strokeDasharray="15 6 45 12" opacity="0.95" />
          <circle cx="250" cy="250" r="82" stroke="#FFFFFF" strokeWidth="1.5" fill="none" strokeDasharray="3 3" opacity="0.7" />
          <circle cx="250" cy="250" r="70" stroke="#FFFFFF" strokeWidth="2.5" fill="none" strokeDasharray="40 10 20 10" opacity="0.85" />
        </g>

        <g
          style={{
            transform: `scale(${centerScale})`,
            transformOrigin: '250px 250px',
            transition: 'transform 0.08s ease-out',
          }}
        >
          <circle cx="250" cy="250" r="48" stroke="#FFFFFF" strokeWidth="1.5" fill="none" opacity="0.6" />
          <circle cx="250" cy="250" r="38" stroke="#FFFFFF" strokeWidth="3" fill="none" strokeDasharray="25 6" opacity="0.9" />
          <circle cx="250" cy="250" r="26" stroke="#FFFFFF" strokeWidth="1.5" fill="none" strokeDasharray="2 4" opacity="0.5" />
          <circle cx="250" cy="250" r="14" fill={state === 'error' ? '#E0002A' : state === 'listening' ? '#FFFFFF' : '#E0E0E0'} opacity={state === 'error' ? 0.9 : 0.9} />
        </g>
      </svg>

      <div className="absolute bottom-2 font-mono text-[10px] tracking-widest text-neutral-400 uppercase bg-black/80 px-2 py-0.5 border border-white/20">
        MODE // {state}
      </div>
    </div>
  );
};