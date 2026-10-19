import React, { useEffect } from "react";
import "./App.css";
import { OperaShell, ShellTab } from "./components/layout/OperaShell";
import { TaskBoard } from "./components/TaskBoard";
import { ChatPanel } from "./components/ChatPanel";
import { IntegrationsHealth } from "./components/IntegrationsHealth";
import { FocusGuardian } from "./components/FocusGuardian";
import { DailyBriefing } from "./components/DailyBriefing";
import { ProfileSettings } from "./components/ProfileSettings";
import { AssignmentFeed } from "./components/AssignmentFeed";
import { RecallPanel } from "./components/RecallPanel";
import { ScreenContext } from "./components/ScreenContext";
import { AutomationPanel } from "./components/AutomationPanel";
import { CommandPalette } from "./components/CommandPalette";
import { bridgeAvailable } from "./lib/sprygen";
import { BridgeError } from "./components/BridgeError";
import { wireVoiceLoop } from "./lib/voiceLoop";

export default function App() {
  const bridgeReady = bridgeAvailable();

  useEffect(() => {
    if (!bridgeReady) return;
    // Speech-to-speech: recognised voice commands go through chat and the
    // answer is spoken back (see lib/voiceLoop).
    return wireVoiceLoop();
  }, [bridgeReady]);

  const renderContent = (tab: ShellTab) => {
    switch (tab) {
      case "console":
        return null;
      case "auto":
        return <AutomationPanel />;
      case "focus":
        return (
          <div className="app__grid app__grid--single">
            <FocusGuardian />
          </div>
        );
      case "memory":
        return (
          <div className="app__grid app__grid--single">
            <RecallPanel />
            <ScreenContext />
          </div>
        );
      case "config":
        return (
          <div className="app__grid app__grid--single">
            <ProfileSettings />
            <IntegrationsHealth />
            <AssignmentFeed />
            <DailyBriefing />
            <TaskBoard />
            <ChatPanel />
          </div>
        );
      default:
        return null;
    }
  };

  if (!bridgeReady) return <BridgeError />;

  return (
    <div className="app">
      <OperaShell renderContent={renderContent} />
      <CommandPalette />
    </div>
  );
}