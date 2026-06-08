import React, { useState, useEffect, useCallback } from 'react';

type ToastType = 'info' | 'success' | 'warning' | 'error';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  exiting: boolean;
}

const TYPE_COLORS: Record<ToastType, string> = {
  info: 'var(--accent)',
  success: '#10b981',
  warning: '#f59e0b',
  error: '#f43f5e',
};

let nextId = 1;
const MAX_VISIBLE = 5;
const DEFAULT_DURATION = 4000;

const slideInKeyframes = `
@keyframes catalystToastSlideIn {
  from { transform: translateX(100%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}
@keyframes catalystToastSlideOut {
  from { transform: translateX(0);    opacity: 1; }
  to   { transform: translateX(100%); opacity: 0; }
}
`;

let styleInjected = false;
function injectKeyframes() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = slideInKeyframes;
  document.head.appendChild(style);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 280);
  }, []);

  useEffect(() => {
    injectKeyframes();

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        message?: string;
        type?: ToastType;
        duration?: number;
      } | undefined;
      if (!detail || !detail.message) return;

      const id = String(nextId++);
      const toast: Toast = {
        id,
        message: detail.message,
        type: detail.type ?? 'info',
        duration: detail.duration ?? DEFAULT_DURATION,
        exiting: false,
      };

      setToasts((prev) => {
        const next = [...prev, toast];
        if (next.length > MAX_VISIBLE) {
          const overflow = next.slice(0, next.length - MAX_VISIBLE);
          for (const t of overflow) {
            t.exiting = true;
          }
          setTimeout(() => {
            setToasts((cur) =>
              cur.filter((c) => !overflow.some((o) => o.id === c.id))
            );
          }, 280);
        }
        return next;
      });
    };

    window.addEventListener('catalyst-toast', handler);
    return () => window.removeEventListener('catalyst-toast', handler);
  }, []);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const toast of toasts) {
      if (!toast.exiting) {
        const timer = setTimeout(() => dismiss(toast.id), toast.duration);
        timers.push(timer);
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minWidth: 280,
            maxWidth: 400,
            padding: 12,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderLeft: `3px solid ${TYPE_COLORS[toast.type]}`,
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            pointerEvents: 'auto',
            animation: toast.exiting
              ? 'catalystToastSlideOut 280ms ease forwards'
              : 'catalystToastSlideIn 280ms ease both',
          }}
        >
          <span
            style={{
              flex: 1,
              fontSize: 13,
              color: 'var(--text-primary)',
              lineHeight: 1.4,
            }}
          >
            {toast.message}
          </span>
          <button
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss notification"
            style={{
              flexShrink: 0,
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              background: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              borderRadius: 'var(--radius-sm)',
              padding: 0,
              fontSize: 16,
              lineHeight: 1,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)';
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)';
              (e.currentTarget as HTMLButtonElement).style.background = 'none';
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
