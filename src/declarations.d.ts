declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

declare module 'node-pty' {
  export interface IPty {
    pid: number;
    onData(callback: (data: string) => void): void;
    onExit(callback: (e: { exitCode: number }) => void): void;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(): void;
  }

  export function spawn(
    file: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    }
  ): IPty;
}

declare module 'systeminformation' {
  export function currentLoad(): Promise<{ currentLoad: number }>;
  export function mem(): Promise<{ total: number; used: number }>;
  export function graphics(): Promise<{
    controllers: Array<{ utilizationGpu?: number }>;
  }>;
  export function processes(): Promise<{
    list: Array<{
      pid: number;
      parentPid: number;
      cpu: number;
      mem_rss: number;
    }>;
  }>;
}

interface Window {
  electronAPI: {
    terminal: {
      onData: (cb: (data: string) => void) => void;
      onExit: (cb: (code: number) => void) => void;
      onReady: (cb: (pid: number) => void) => void;
      sendInput: (data: string) => void;
      resize: (cols: number, rows: number) => void;
      restart: () => void;
    };
    resources: {
      onUpdate: (cb: (data: import('./shared/types').ResourceSnapshot) => void) => void;
      start: () => void;
      stop: () => void;
    };
    compact: {
      getStatus: () => Promise<import('./shared/types').CompactStatus>;
      install: () => Promise<boolean>;
      uninstall: () => Promise<boolean>;
      getConfig: () => Promise<import('./shared/types').CompactConfig>;
      setConfig: (
        config: Partial<import('./shared/types').CompactConfig>
      ) => Promise<import('./shared/types').CompactConfig>;
    };
    window: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
    };
  };
}
