import React, { useState, useRef, useCallback } from 'react';
import { TitleBar } from './components/layout/TitleBar';
import { Sidebar } from './components/layout/Sidebar';
import { StatusBar } from './components/layout/StatusBar';
import { TerminalPanel } from './components/terminal/TerminalPanel';
import { ResourcePanel } from './components/resources/ResourcePanel';
import { CompactPanel } from './components/compact/CompactPanel';
import { CommandsPanel } from './components/commands/CommandsPanel';

export type SidebarPanel =
  | 'terminal'
  | 'commands'
  | 'resources'
  | 'github'
  | 'compact'
  | 'sync'
  | 'auth'
  | 'settings';

export function App() {
  const [activePanel, setActivePanel] = useState<SidebarPanel>('terminal');
  const [claudePid, setClaudePid] = useState<number>(0);
  const terminalSendRef = useRef<((data: string) => void) | null>(null);

  const handleSendCommand = useCallback((command: string) => {
    if (terminalSendRef.current) {
      terminalSendRef.current(command + '\r');
    }
    setActivePanel('terminal');
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
      }}
    >
      <TitleBar />
      <div
        style={{
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
        }}
      >
        <Sidebar activePanel={activePanel} onPanelChange={setActivePanel} />
        <div
          style={{
            flex: 1,
            display: 'flex',
            overflow: 'hidden',
          }}
        >
          <TerminalPanel
            onPidChange={setClaudePid}
            sendRef={terminalSendRef}
          />
          {activePanel !== 'terminal' && (
            <div
              style={{
                width: 320,
                borderLeft: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-secondary)',
                padding: 16,
                overflowY: 'auto',
              }}
            >
              <RightPanel
                panel={activePanel}
                onSendCommand={handleSendCommand}
              />
            </div>
          )}
        </div>
      </div>
      <StatusBar pid={claudePid} />
    </div>
  );
}

function RightPanel({
  panel,
  onSendCommand,
}: {
  panel: SidebarPanel;
  onSendCommand: (command: string) => void;
}) {
  switch (panel) {
    case 'resources':
      return <ResourcePanel />;
    case 'compact':
      return <CompactPanel />;
    case 'commands':
      return <CommandsPanel onSendCommand={onSendCommand} />;
    default: {
      const placeholders: Record<string, string> = {
        github: 'GitHub Integration — Coming in Phase 4',
        sync: 'Cloud Sync — Coming in Phase 6',
        auth: 'Authentication — Coming in Phase 5',
        settings: 'Settings — Coming in Phase 7',
      };
      return (
        <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          <h3 style={{ marginBottom: 8, color: 'var(--text-primary)' }}>
            {panel.charAt(0).toUpperCase() + panel.slice(1)}
          </h3>
          <p>{placeholders[panel] || ''}</p>
        </div>
      );
    }
  }
}
