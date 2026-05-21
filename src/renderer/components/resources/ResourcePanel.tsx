import React, { useEffect, useState } from 'react';
import { GaugeBar } from './GaugeBar';
import type { ResourceSnapshot } from '../../../shared/types';

export function ResourcePanel() {
  const [snapshot, setSnapshot] = useState<ResourceSnapshot | null>(null);

  useEffect(() => {
    window.electronAPI.resources.onUpdate((data) => {
      setSnapshot(data as ResourceSnapshot);
    });
  }, []);

  if (!snapshot) {
    return (
      <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
        <h3
          style={{
            marginBottom: 12,
            color: 'var(--text-primary)',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Resource Monitor
        </h3>
        <p>Waiting for data...</p>
      </div>
    );
  }

  return (
    <div>
      <h3
        style={{
          marginBottom: 16,
          color: 'var(--text-primary)',
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        Resource Monitor
      </h3>

      <GaugeBar
        label="CPU"
        systemPercent={snapshot.system.cpuPercent}
        claudePercent={snapshot.claude.cpuPercent}
      />

      <GaugeBar
        label="RAM"
        systemPercent={snapshot.system.ramPercent}
        claudePercent={snapshot.claude.ramPercent}
        detail={`${snapshot.system.ramUsedGB.toFixed(1)} / ${snapshot.system.ramTotalGB.toFixed(1)} GB`}
      />

      <GaugeBar
        label="GPU"
        systemPercent={snapshot.system.gpuPercent ?? 0}
        claudePercent={0}
        unavailable={snapshot.system.gpuPercent === null}
      />

      <div
        style={{
          marginTop: 16,
          padding: '8px 10px',
          backgroundColor: 'var(--bg-primary)',
          borderRadius: 6,
          fontSize: 12,
          color: 'var(--text-secondary)',
        }}
      >
        <div>
          Claude processes:{' '}
          <span style={{ color: 'var(--text-primary)' }}>
            {snapshot.claude.pidCount}
          </span>
        </div>
        <div>
          Claude RAM:{' '}
          <span style={{ color: 'var(--text-primary)' }}>
            {snapshot.claude.ramMB} MB
          </span>
        </div>
      </div>
    </div>
  );
}
