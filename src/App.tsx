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
import { jarvis } from "./lib/jarvis";
import { useChat } from "./store/chat";

export default function App() {
  const send = useChat((s) => s.send);

  useEffect(() => {
    const unsubTranscript = jarvis.onEvent("voice:transcript", (text: string) => {
      send(text);
    });

    return () => {
      unsubTranscript();
    };
  }, [send]);

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

  return (
    <div className="app">
      <OperaShell renderContent={renderContent} />
      <CommandPalette />
    </div>
  );
}