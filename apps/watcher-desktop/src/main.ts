import { app, BrowserWindow, Tray, Menu, ipcMain, dialog } from 'electron';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AccessLoginRequest,
  DesktopUiState,
  McpDiffPreview,
  ProjectDraft,
  ProjectImportResult,
  WatcherServiceActionRequest,
} from './contracts.js';
import { loginAccess, readAccessState } from './desktop-access.js';
import { buildDesktopConfigPackage } from './desktop-config-package.js';
import { buildDesktopConnectionCheck } from './desktop-connection-check.js';
import { importProjectConfig } from './desktop-config-import.js';
import { listDesktopModeSummaries } from './desktop-mode-summary.js';
import { readDesktopUiState, saveDesktopUiState } from './desktop-ui-state.js';
import {
  previewDiagnostics,
  previewMcpDiff,
  readProfiles,
  readServiceStatus,
  runServiceAction,
  saveProfile,
  type DesktopCorePaths,
} from './desktop-core.js';

const DEBUG_PORT = '9223';
const desktopDebugEnabled = process.env.PROJECT_BRAIN_DESKTOP_DEBUG === '1';
const desktopDevToolsEnabled = process.env.PROJECT_BRAIN_DESKTOP_DEVTOOLS === '1';
const desktopUserDataPath = process.env.PROJECT_BRAIN_DESKTOP_USER_DATA_DIR?.trim();

if (desktopDebugEnabled) {
  app.commandLine.appendSwitch('remote-debugging-port', DEBUG_PORT);
}

app.enableSandbox();

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

app.whenReady().then(() => {
  registerIpcHandlers();
  Menu.setApplicationMenu(null);
  mainWindow = createMainWindow();
  tray = createTray(mainWindow);
});

app.on('window-all-closed', () => {
  if (tray) mainWindow?.hide();
  else app.quit();
});

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    title: 'Project Brain Watcher',
    show: false,
    webPreferences: {
      preload: join(app.getAppPath(), 'dist', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.loadFile(join(app.getAppPath(), 'src', 'index.html'));
  window.webContents.once('did-finish-load', () => {
    window.show();
    window.focus();
    if (desktopDevToolsEnabled) {
      window.webContents.openDevTools({ mode: 'detach' });
    }
  });
  return window;
}

function createTray(window: BrowserWindow): Tray | null {
  const iconPath = join(app.getAppPath(), 'src', 'tray.ico');
  if (!existsSync(iconPath)) return null;
  const appTray = new Tray(iconPath);
  appTray.setToolTip('Project Brain Watcher');
  appTray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Статус: открыть пульт', click: () => window.show() },
    { label: 'Проверить подключение', click: () => { window.show(); window.webContents.reloadIgnoringCache(); } },
    { label: 'Перезапустить окно', click: () => { window.show(); window.webContents.reloadIgnoringCache(); } },
    { type: 'separator' },
    { label: 'Закрыть', click: () => app.quit() },
  ]));
  return appTray;
}

function registerIpcHandlers(): void {
  ipcMain.handle('access:status', () => readAccessState(corePaths()));
  ipcMain.handle('access:login', (_event, request: AccessLoginRequest) => loginAccess(corePaths(), request));
  ipcMain.handle('ui:load-state', () => readDesktopUiState(corePaths()));
  ipcMain.handle('ui:save-state', (_event, state: DesktopUiState) => saveDesktopUiState(corePaths(), state));
  ipcMain.handle('service:status', () => readServiceStatus(corePaths()));
  ipcMain.handle('service:run', (_event, request: WatcherServiceActionRequest) => (
    runServiceAction(corePaths(), request)
  ));
  ipcMain.handle('service:full-check', (_event, projectId: string) => (
    buildDesktopConnectionCheck(corePaths(), projectId)
  ));
  ipcMain.handle('projects:list', () => readProfiles(corePaths()));
  ipcMain.handle('projects:save', (_event, project: ProjectDraft) => saveProfile(corePaths(), project));
  ipcMain.handle('projects:select-root', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('projects:import-config', async (): Promise<ProjectImportResult | null> => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'MCP config', extensions: ['json'] }],
      properties: ['openFile'],
    });
    const sourcePath = result.canceled ? null : result.filePaths[0] ?? null;
    return sourcePath ? importProjectConfig(corePaths(), sourcePath) : null;
  });
  ipcMain.handle('projects:build-config-package', (_event, projectId: string) => (
    buildDesktopConfigPackage(corePaths(), projectId)
  ));
  ipcMain.handle('projects:save-config-package', async (_event, projectId: string): Promise<string | null> => {
    const pack = buildDesktopConfigPackage(corePaths(), projectId);
    const result = await dialog.showSaveDialog({
      defaultPath: pack.fileName,
      filters: [{ name: 'MCP config package', extensions: ['json'] }],
    });
    const targetPath = result.canceled ? null : result.filePath ?? null;
    if (!targetPath) return null;
    writeFileSync(targetPath, pack.configJson, 'utf-8');
    return targetPath;
  });
  ipcMain.handle('mcp:preview-diff', (_event, client: McpDiffPreview['client']) => (
    previewMcpDiff(corePaths(), client)
  ));
  ipcMain.handle('modes:list', () => listDesktopModeSummaries(corePaths()));
  ipcMain.handle('diagnostics:preview-export', () => previewDiagnostics(corePaths()));
}

function corePaths(): DesktopCorePaths {
  return {
    homePath: app.getPath('home'),
    userDataPath: desktopUserDataPath || app.getPath('userData'),
  };
}
