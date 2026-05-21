import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';

contextBridge.exposeInMainWorld('electronAPI', {
  terminal: {
    onData: (callback: (data: string) => void) => {
      ipcRenderer.on(IPC.TERMINAL_DATA, (_event, data) => callback(data));
    },
    onExit: (callback: (code: number) => void) => {
      ipcRenderer.on(IPC.TERMINAL_EXIT, (_event, code) => callback(code));
    },
    onReady: (callback: (pid: number) => void) => {
      ipcRenderer.on(IPC.TERMINAL_READY, (_event, pid) => callback(pid));
    },
    sendInput: (data: string) => {
      ipcRenderer.send(IPC.TERMINAL_INPUT, data);
    },
    resize: (cols: number, rows: number) => {
      ipcRenderer.send(IPC.TERMINAL_RESIZE, cols, rows);
    },
    restart: () => {
      ipcRenderer.send(IPC.TERMINAL_RESTART);
    },
  },
  resources: {
    onUpdate: (callback: (data: unknown) => void) => {
      ipcRenderer.on(IPC.RESOURCE_UPDATE, (_event, data) => callback(data));
    },
    start: () => ipcRenderer.send(IPC.RESOURCE_START),
    stop: () => ipcRenderer.send(IPC.RESOURCE_STOP),
  },
  compact: {
    getStatus: () => ipcRenderer.invoke(IPC.COMPACT_STATUS),
    install: () => ipcRenderer.invoke(IPC.COMPACT_INSTALL),
    uninstall: () => ipcRenderer.invoke(IPC.COMPACT_UNINSTALL),
    getConfig: () => ipcRenderer.invoke(IPC.COMPACT_CONFIG_GET),
    setConfig: (config: unknown) =>
      ipcRenderer.invoke(IPC.COMPACT_CONFIG_SET, config),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
});
