import React from 'react';

interface GaugeBarProps {
  label: string;
  systemPercent: number;
  claudePercent: number;
  detail?: string;
  unavailable?: boolean;
}

export function GaugeBar({
  label,
  systemPercent,
  claudePercent,
  detail,
  unavailable,
}: GaugeBarProps) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 4,
          fontSize: 12,
        }}
      >
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
          {label}
        </span>
        <span style={{ color: 'var(--text-secondary)' }}>
          {unavailable ? 'N/A' : `${Math.round(systemPercent)}%`}
        </span>
      </div>
      <div
        style={{
          height: 8,
          backgroundColor: 'var(--bg-primary)',
          borderRadius: 4,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {!unavailable && (
          <>
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                height: '100%',
                width: `${Math.min(systemPercent, 100)}%`,
                backgroundColor: 'var(--gauge-grey)',
                borderRadius: 4,
                transition: 'width 0.5s ease',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                height: '100%',
                width: `${Math.min(claudePercent, 100)}%`,
                backgroundColor: 'var(--gauge-purple)',
                borderRadius: 4,
                transition: 'width 0.5s ease',
              }}
            />
          </>
        )}
      </div>
      {detail && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            marginTop: 2,
          }}
        >
          {detail}
        </div>
      )}
      {!unavailable && (
        <div
          style={{
            display: 'flex',
            gap: 12,
            marginTop: 4,
            fontSize: 10,
          }}
        >
          <span>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: 2,
                backgroundColor: 'var(--gauge-purple)',
                marginRight: 4,
                verticalAlign: 'middle',
              }}
            />
            <span style={{ color: 'var(--text-secondary)' }}>
              Claude {Math.round(claudePercent)}%
            </span>
          </span>
          <span>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: 2,
                backgroundColor: 'var(--gauge-grey)',
                marginRight: 4,
                verticalAlign: 'middle',
              }}
            />
            <span style={{ color: 'var(--text-secondary)' }}>
              System {Math.round(systemPercent)}%
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
