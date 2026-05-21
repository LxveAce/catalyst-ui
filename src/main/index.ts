import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { PtyManager } from './pty-manager';
import { ResourceMonitor } from './resource-monitor';
import { CompactController } from './compact-controller';
import { IPC } from '../shared/ipc-channels';

if (require('electron-squirrel-startup')) {
  app.quit();
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
const ptyManager = new PtyManager();
const resourceMonitor = new ResourceMonitor();
const compactController = new CompactController();

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('close', () => {
    resourceMonitor.stop();
    ptyManager.kill();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
};

function safeSend(channel: string, ...args: unknown[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function setupTerminal() {
  ptyManager.on('data', (data: string) => {
    safeSend(IPC.TERMINAL_DATA, data);
  });

  ptyManager.on('exit', (code: number) => {
    safeSend(IPC.TERMINAL_EXIT, code);
  });

  ptyManager.on('ready', (pid: number) => {
    safeSend(IPC.TERMINAL_READY, pid);
    resourceMonitor.setClaudePid(pid);
  });

  ipcMain.on(IPC.TERMINAL_INPUT, (_event, data: string) => {
    ptyManager.write(data);
  });

  ipcMain.on(IPC.TERMINAL_RESIZE, (_event, cols: number, rows: number) => {
    ptyManager.resize(cols, rows);
  });

  ipcMain.on(IPC.TERMINAL_RESTART, () => {
    ptyManager.kill();
    ptyManager.spawn();
  });

  ptyManager.spawn();
}

function setupResources() {
  resourceMonitor.on('update', (snapshot) => {
    safeSend(IPC.RESOURCE_UPDATE, snapshot);
  });

  ipcMain.on(IPC.RESOURCE_START, () => resourceMonitor.start());
  ipcMain.on(IPC.RESOURCE_STOP, () => resourceMonitor.stop());

  resourceMonitor.start();
}

function setupCompact() {
  ipcMain.handle(IPC.COMPACT_STATUS, () => compactController.getStatus());
  ipcMain.handle(IPC.COMPACT_INSTALL, () => compactController.install());
  ipcMain.handle(IPC.COMPACT_UNINSTALL, () => compactController.uninstall());
  ipcMain.handle(IPC.COMPACT_CONFIG_GET, () => compactController.getConfig());
  ipcMain.handle(IPC.COMPACT_CONFIG_SET, (_event, config) =>
    compactController.setConfig(config)
  );
}

function setupWindowControls() {
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window:close', () => mainWindow?.close());
}

app.whenReady().then(() => {
  createWindow();
  setupTerminal();
  setupResources();
  setupCompact();
  setupWindowControls();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  ptyManager.kill();
  resourceMonitor.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
