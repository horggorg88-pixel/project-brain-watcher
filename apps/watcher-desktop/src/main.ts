import { app, BrowserWindow, Tray, Menu, ipcMain, dialog, clipboard } from 'electron';
import { existsSync, writeFileSync } from 'node:fs';
import type { AccessLoginRequest, DesktopConfigSaveResult, DesktopUiState, McpDiffPreview, ProjectDraft, ProjectImportResult, WatcherServiceActionRequest } from './contracts.js';
import { loginAccess, logoutAccess, readAccessState } from './desktop-access.js';
import { resolveDesktopAppAssetPaths } from './desktop-app-paths.js';
import { buildDesktopConfigPackage } from './desktop-config-package.js';
import { buildDesktopConnectionCheck } from './desktop-connection-check.js';
import { importProjectConfig } from './desktop-config-import.js';
import { listDesktopModeSummaries } from './desktop-mode-summary.js';
import { readDesktopUiState, saveDesktopUiState } from './desktop-ui-state.js';
import { previewDiagnostics, previewMcpDiff, listDesktopProjectProfiles, readServiceStatus, runServiceAction, saveProfile, type DesktopCorePaths } from './desktop-core.js';

const DEBUG_PORT = '9223';
const desktopDebugEnabled = process.env.PROJECT_BRAIN_DESKTOP_DEBUG === '1';
const desktopDevToolsEnabled = process.env.PROJECT_BRAIN_DESKTOP_DEVTOOLS === '1';
const desktopUserDataPath = process.env.PROJECT_BRAIN_DESKTOP_USER_DATA_DIR?.trim();

if (desktopUserDataPath) app.setPath('userData', desktopUserDataPath);

if (desktopDebugEnabled) app.commandLine.appendSwitch('remote-debugging-port', DEBUG_PORT);

app.enableSandbox();

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

app.whenReady().then(() => {
  registerIpcHandlers();
  Menu.setApplicationMenu(null);
  mainWindow = createMainWindow();
  tray = createTray(mainWindow);
});

app.on('second-instance', () => showMainWindow());

app.on('activate', () => showMainWindow());

app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', () => {
  if (tray) mainWindow?.hide();
  else app.quit();
});

function createMainWindow(): BrowserWindow {
  const assetPaths = resolveDesktopAppAssetPaths(app.getAppPath());
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    title: 'Project Brain Watcher',
    show: false,
    frame: false,
    icon: assetPaths.appIconPath,
    webPreferences: {
      preload: assetPaths.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.on('close', event => {
    if (isQuitting) return;
    event.preventDefault();
    window.hide();
  });
  window.loadFile(assetPaths.indexHtmlPath);
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
  const { trayIconPath } = resolveDesktopAppAssetPaths(app.getAppPath());
  const iconPath = trayIconPath;
  if (!existsSync(iconPath)) return null;
  const appTray = new Tray(iconPath);
  appTray.setToolTip('Project Brain Watcher');
  appTray.on('click', () => showMainWindow());
  appTray.on('double-click', () => showMainWindow());
  appTray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Статус: открыть пульт', click: () => showMainWindow() },
    { label: 'Проверить подключение', click: () => { showMainWindow(); window.webContents.reloadIgnoringCache(); } },
    { label: 'Перезапустить окно', click: () => { showMainWindow(); window.webContents.reloadIgnoringCache(); } },
    { type: 'separator' },
    { label: 'Закрыть', click: () => { isQuitting = true; app.quit(); } },
  ]));
  return appTray;
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    if (!tray) tray = createTray(mainWindow);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function registerIpcHandlers(): void {
  ipcMain.handle('access:status', () => readAccessState(corePaths()));
  ipcMain.handle('access:login', (_event, request: AccessLoginRequest) => loginAccess(corePaths(), request));
  ipcMain.handle('access:logout', () => logoutAccess(corePaths()));
  ipcMain.handle('ui:load-state', () => readDesktopUiState(corePaths()));
  ipcMain.handle('ui:save-state', (_event, state: DesktopUiState) => saveDesktopUiState(corePaths(), state));
  ipcMain.handle('service:status', (_event, projectId?: string) => readServiceStatus(corePaths(), projectId));
  ipcMain.handle('service:run', (_event, request: WatcherServiceActionRequest) => (
    runServiceAction(corePaths(), request)
  ));
  ipcMain.handle('service:full-check', (_event, projectId: string) => (
    buildDesktopConnectionCheck(corePaths(), projectId)
  ));
  ipcMain.handle('projects:list', () => listDesktopProjectProfiles(corePaths()));
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
  ipcMain.handle('projects:save-config-package', async (_event, projectId: string): Promise<DesktopConfigSaveResult | null> => {
    const pack = buildDesktopConfigPackage(corePaths(), projectId, { bootstrap: true });
    const result = await dialog.showSaveDialog({
      defaultPath: pack.fileName,
      filters: [{ name: 'MCP config package', extensions: ['json'] }],
    });
    const targetPath = result.canceled ? null : result.filePath ?? null;
    if (!targetPath) return null;
    writeFileSync(targetPath, pack.configJson, 'utf-8');
    return {
      packagePath: targetPath,
      brainDir: pack.brainDir,
      brainConfigPath: pack.brainConfigPath,
      brainMcpPath: pack.brainMcpPath,
    };
  });
  ipcMain.handle('mcp:preview-diff', (_event, client: McpDiffPreview['client']) => (
    previewMcpDiff(corePaths(), client)
  ));
  ipcMain.handle('modes:list', (_event, projectId?: string) => listDesktopModeSummaries(corePaths(), projectId));
  ipcMain.handle('diagnostics:preview-export', (_event, projectId?: string) => previewDiagnostics(corePaths(), projectId));
  ipcMain.handle('clipboard:write-text', (_event, value: string) => {
    clipboard.writeText(value);
  });
  ipcMain.handle('window:minimize', event => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle('window:toggle-maximize', event => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return window.isMaximized();
  });
  ipcMain.handle('window:close', event => {
    BrowserWindow.fromWebContents(event.sender)?.hide();
  });
}

function corePaths(): DesktopCorePaths {
  return {
    homePath: app.getPath('home'),
    userDataPath: desktopUserDataPath || app.getPath('userData'),
  };
}
