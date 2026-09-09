// src/components/layout/OperaShell.tsx
import React, { useState, useEffect } from 'react';
import { TitleBar } from './TitleBar';
import { ArcReactorHUD, HUDState } from '../hud/ArcReactorHUD';
import { Mic, Bot, Shield, Database, Settings, Play, Camera, Terminal } from 'lucide-react';
import { useVoice } from '../../store/voice';
import { useUI } from '../../store/ui';
import { useScreen } from '../../store/screen';
import { useAutomation } from '../../store/automation';

export type ShellTab = 'console' | 'auto' | 'focus' | 'memory' | 'config';

interface OperaShellProps {
  renderContent: (tab: ShellTab) => React.ReactNode;
}

export const OperaShell: React.FC<OperaShellProps> = ({ renderContent }) => {
  const [activeTab, setActiveTab] = useState<ShellTab>('console');
  const status = useVoice((s) => s.status);
  const audioLevel = useVoice((s) => s.audioLevel);
  const voiceError = useVoice((s) => s.error);
  const setListening = useVoice((s) => s.setListening);
  const openPalette = useUI((s) => s.openPalette);
  const captureScreen = useScreen((s) => s.capture);
  const autoActive = useAutomation((s) => s.status.active);

  const hudState: HUDState =
    voiceError
      ? 'error'
      : autoActive
        ? 'automating'
        : status?.state === 'listening' || status?.state === 'verifying'
          ? 'listening'
          : status?.state === 'processing'
            ? 'processing'
            : status?.state === 'speaking'
              ? 'processing'
              : 'idle';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openPalette();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPalette]);

  useEffect(() => {
    const t = setInterval(() => void useAutomation.getState().refresh(), 2500);
    return () => clearInterval(t);
  }, []);

  const toggleEngine = () => {
    setListening(status?.active !== true);
  };

  const handleScreenCapture = () => {
    void captureScreen('Summarize what is currently on screen.');
  };

  const tabs: { id: ShellTab; icon: React.ReactNode; label: string }[] = [
    { id: 'console', icon: <Mic className="w-4 h-4" />, label: 'Voice & Assistant Core' },
    { id: 'auto', icon: <Bot className="w-4 h-4" />, label: 'Selenium & PyAutoGUI Automation' },
    { id: 'focus', icon: <Shield className="w-4 h-4" />, label: 'Focus Guardian (Notification Queue)' },
    { id: 'memory', icon: <Database className="w-4 h-4" />, label: 'Memory Recall Timeline' },
  ];

  return (
    <div className="h-screen w-screen bg-[#000000] text-neutral-200 flex flex-col font-sans overflow-hidden select-none">
      <TitleBar status={hudState} />

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-14 bg-[#08080A] border-r border-white/10 flex flex-col items-center py-3 justify-between z-40">
          <div className="flex flex-col items-center gap-4">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`p-2.5 rounded transition-all duration-150 border ${
                  activeTab === t.id
                    ? 'border-white bg-white/10 text-white shadow-[0_0_8px_rgba(255,255,255,0.25)]'
                    : 'border-transparent text-neutral-400 hover:text-white hover:bg-white/5'
                }`}
                title={t.label}
              >
                {t.icon}
              </button>
            ))}
            <button
              onClick={handleScreenCapture}
              className="p-2.5 rounded transition-all duration-150 border border-transparent text-neutral-400 hover:text-white hover:bg-white/5"
              title="Capture screen context"
            >
              <Camera className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col items-center gap-3">
            <button
              onClick={() => setActiveTab('config')}
              className={`p-2.5 rounded transition-all duration-150 border ${
                activeTab === 'config'
                  ? 'border-white bg-white/10 text-white shadow-[0_0_8px_rgba(255,255,255,0.25)]'
                  : 'border-transparent text-neutral-400 hover:text-white hover:bg-white/5'
              }`}
              title="Configuration"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </aside>

        <main className="flex-1 bg-[#050507] flex flex-col relative overflow-hidden">
          <div className="h-10 border-b border-white/10 px-6 flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="text-white/40">// SECTION:</span>
              <span className="text-white uppercase font-bold tracking-wide">{activeTab}</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleScreenCapture}
                className="px-2.5 py-1 border border-white/20 hover:border-white text-[11px] uppercase tracking-wider text-neutral-300 hover:text-white flex items-center gap-1.5 transition-colors"
              >
                <Camera className="w-2.5 h-2.5" /> Capture Screen
              </button>
              <button
                onClick={toggleEngine}
                className="px-2.5 py-1 border border-white/20 hover:border-white text-[11px] uppercase tracking-wider text-neutral-300 hover:text-white flex items-center gap-1.5 transition-colors"
              >
                <Play className="w-2.5 h-2.5" /> {status?.active ? 'Stop Engine' : 'Toggle Engine'}
              </button>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center p-6 relative">
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:16px_16px]" />

            {activeTab === 'console' && (
              <div className="z-10 flex flex-col items-center gap-4">
                <ArcReactorHUD state={hudState} decibels={audioLevel} />
                {voiceError && (
                  <div className="font-mono text-[10px] tracking-widest text-[#E0002A] uppercase border border-[#E0002A]/40 px-3 py-1 bg-[#E0002A]/10">
                    [{voiceError.code}] {voiceError.message}
                  </div>
                )}
              </div>
            )}

            {activeTab !== 'console' && (
              <div className="z-10 w-full h-full overflow-y-auto flex items-start justify-center py-4">
                {renderContent(activeTab)}
              </div>
            )}
          </div>

          <footer className="h-8 border-t border-white/10 px-4 bg-[#08080A] flex items-center justify-between font-mono text-[10px] text-neutral-400">
            <div className="flex items-center gap-4">
              {autoActive && (
                <span className="text-white font-semibold uppercase tracking-widest flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" /> AUTOMATION ACTIVE
                </span>
              )}
              <span>DRIVER: PvRecorder (Main Proc)</span>
              <span>SCRIPTS: Selenium/BS4 Loaded</span>
            </div>
            <div>
              <span className="text-white/60 flex items-center gap-1.5">
                <Terminal className="w-2.5 h-2.5" /> PRESS [CTRL + K] COMMAND PALETTE
              </span>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
};