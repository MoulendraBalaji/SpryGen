// src/components/layout/TitleBar.tsx
import React, { useState, useEffect } from 'react';
import { Minus, Square, Copy, X, Cpu, ShieldCheck, Volume2 } from 'lucide-react';

type EngineStatus = 'idle' | 'listening' | 'processing' | 'automating' | 'speaking' | 'error';

export const TitleBar: React.FC<{ status?: EngineStatus }> = ({ status = 'idle' }) => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    window.jarvis?.window?.isMaximized().then(setIsMaximized);
    const unsub = window.jarvis?.onEvent('window:maximized-change', (isMax: boolean) => {
      setIsMaximized(isMax);
    });
    return () => {
      unsub?.();
    };
  }, []);

  const handleMinimize = () => window.jarvis?.window?.minimize();
  const handleMaximize = () => {
    window.jarvis?.window?.maximize();
    setIsMaximized(!isMaximized);
  };
  const handleClose = () => window.jarvis?.window?.close();

  const active = status === 'listening' || status === 'processing' || status === 'automating' || status === 'speaking';
  const statusLabel =
    status === 'listening'
      ? 'MIC ACTIVE'
      : status === 'automating'
        ? 'AUTOMATING'
        : status === 'error'
          ? 'ENGINE FAULT'
          : 'SYS: OK';

  return (
    <header
      className="h-9 w-full bg-[#070709] border-b border-white/10 flex items-center justify-between select-none px-2 z-50 text-xs text-neutral-400 font-mono"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-3 pl-1">
        <div className="flex items-center gap-1.5 font-bold tracking-widest text-white">
          <span
            className={`inline-block w-2 h-2 rounded-full ${status === 'error' ? 'bg-[#E0002A]' : status === 'listening' ? 'bg-white animate-pulse shadow-[0_0_8px_#ffffff]' : 'bg-white/60'}`}
          />
          SPRYGEN
        </div>
        <span className="text-white/20">|</span>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-neutral-400">
          <span className="flex items-center gap-1">
            <Cpu className="w-3 h-3 text-neutral-500" /> SYS: OK
          </span>
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-neutral-500" /> GUARDIAN: ACTIVE
          </span>
          <span className="flex items-center gap-1">
            <Volume2 className={`w-3 h-3 ${active ? 'text-white animate-pulse' : 'text-neutral-500'}`} />{' '}
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="flex items-center h-full" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={handleMinimize}
          className="h-full px-3.5 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors duration-150"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleMaximize}
          className="h-full px-3.5 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors duration-150"
          title="Maximize/Restore"
        >
          {isMaximized ? <Copy className="w-3 h-3" /> : <Square className="w-3 h-3" />}
        </button>
        <button
          onClick={handleClose}
          className="h-full px-4 flex items-center justify-center hover:bg-[#E0002A] hover:text-white transition-colors duration-150"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};