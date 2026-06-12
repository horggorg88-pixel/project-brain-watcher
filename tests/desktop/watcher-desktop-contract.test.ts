import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = join(process.cwd(), 'apps', 'watcher-desktop');

describe('watcher desktop contract', () => {
  it('keeps Electron renderer isolated', () => {
    const mainSource = readFileSync(join(appRoot, 'src', 'main.ts'), 'utf-8');

    expect(mainSource).toContain('contextIsolation: true');
    expect(mainSource).toContain('nodeIntegration: false');
    expect(mainSource).toContain('sandbox: true');
    expect(mainSource).toContain('app.enableSandbox()');
    expect(mainSource).toContain("app.commandLine.appendSwitch('remote-debugging-port'");
    expect(mainSource).toContain('show: false');
    expect(mainSource).toContain('frame: false');
    expect(mainSource).toContain('icon: assetPaths.appIconPath');
    expect(mainSource).toContain('window.show()');
    expect(mainSource).toContain('window.focus()');
    expect(mainSource).toContain("window.webContents.openDevTools({ mode: 'detach' })");
    expect(mainSource).toContain('Menu.setApplicationMenu(null)');
    expect(mainSource).toContain("process.env.PROJECT_BRAIN_DESKTOP_DEBUG === '1'");
    expect(mainSource).toContain("process.env.PROJECT_BRAIN_DESKTOP_DEVTOOLS === '1'");
    expect(mainSource).toContain('PROJECT_BRAIN_DESKTOP_USER_DATA_DIR');
    expect(mainSource).toContain("app.setPath('userData', desktopUserDataPath)");
    expect(mainSource).toContain("app.on('second-instance'");
    expect(mainSource).toContain("app.on('activate'");
    expect(mainSource).toContain("app.on('before-quit'");
    expect(mainSource).toContain('function showMainWindow()');
    expect(mainSource).toContain('mainWindow.isMinimized()');
    expect(mainSource).toContain("appTray.on('click'");
    expect(mainSource).toContain("appTray.on('double-click'");
    expect(mainSource).toContain("event.preventDefault()");
    expect(mainSource).toContain("window.hide()");
    expect(mainSource).not.toContain('nativeImage.createEmpty()');
    expect(mainSource).toContain('if (!existsSync(iconPath)) return null');
  });

  it('exposes typed preload APIs without raw ipcRenderer forwarding', () => {
    const preloadSource = readFileSync(join(appRoot, 'src', 'preload.cts'), 'utf-8');
    const contractsSource = readFileSync(join(appRoot, 'src', 'contracts.ts'), 'utf-8');
    const mainSource = readFileSync(join(appRoot, 'src', 'main.ts'), 'utf-8');
    const rendererSource = readFileSync(join(appRoot, 'src', 'renderer.ts'), 'utf-8');
    const rendererViewSource = readFileSync(join(appRoot, 'src', 'renderer-view.ts'), 'utf-8');

    expect(preloadSource).toContain("contextBridge.exposeInMainWorld('watcherDesktop'");
    expect(preloadSource).toContain("ipcRenderer.invoke('access:login'");
    expect(preloadSource).toContain("ipcRenderer.invoke('access:logout'");
    expect(preloadSource).toContain("ipcRenderer.invoke('projects:select-root'");
    expect(preloadSource).toContain("ipcRenderer.invoke('projects:import-config'");
    expect(preloadSource).toContain("ipcRenderer.invoke('projects:build-config-package'");
    expect(preloadSource).toContain("ipcRenderer.invoke('projects:save-config-package'");
    expect(preloadSource).toContain("ipcRenderer.invoke('service:run'");
    expect(preloadSource).toContain("ipcRenderer.invoke('service:full-check'");
    expect(preloadSource).toContain("ipcRenderer.invoke('ui:load-state'");
    expect(preloadSource).toContain("ipcRenderer.invoke('modes:list'");
    expect(preloadSource).not.toContain('ipcRenderer.on');
    expect(preloadSource).not.toContain('send: ipcRenderer.send');
    expect(mainSource).toContain("ipcMain.handle('access:logout'");
    expect(mainSource).toContain("ipcMain.handle('window:minimize'");
    expect(mainSource).toContain("ipcMain.handle('window:toggle-maximize'");
    expect(mainSource).toContain("ipcMain.handle('window:close'");
    expect(contractsSource).not.toContain('readonly serverVerified?: boolean');
    expect(contractsSource).toContain('logout(): Promise<DesktopAccessState>');
    expect(contractsSource).toContain('windowControls');
    expect(contractsSource).toContain('readonly group: string');
    expect(contractsSource).toContain('readonly description: string');
    expect(contractsSource).toContain('readonly whenToUse: string');
    expect(contractsSource).toContain('readonly useCases: readonly string[]');
    expect(preloadSource).toContain("ipcRenderer.invoke('window:minimize'");
    expect(preloadSource).toContain("ipcRenderer.invoke('window:toggle-maximize'");
    expect(preloadSource).toContain("ipcRenderer.invoke('window:close'");
    expect(contractsSource).toContain('buildConfigPackage(projectId: string)');
    expect(contractsSource).toContain('saveConfigPackage(projectId: string): Promise<DesktopConfigSaveResult | null>');
    expect(contractsSource).toContain('brainMcpPath');
    expect(rendererSource).toContain('Папка Brain-конфигов обновлена');
    expect(rendererSource).toContain('.brain/mcp.json с bearer');
    expect(contractsSource).toContain('fullCheck(projectId: string)');
    expect(rendererSource).toContain('service.fullCheck');
    expect(rendererSource).toContain('data-check-action');
    expect(rendererSource).toContain('handleCheckAction');
    expect(rendererSource).toContain("case 'install_service'");
    expect(rendererSource).toContain("case 'start_service'");
    expect(rendererSource).toContain("case 'verify'");
    expect(rendererSource).toContain("case 'download_config'");
    expect(rendererSource).toContain("case 'import_config'");
    expect(rendererSource).toContain('watcherDesktop.access.logout');
    expect(rendererSource).not.toContain('window.confirm');
    expect(rendererViewSource).toContain('data-access-logout');
    expect(rendererViewSource).toContain('mode-group');
    expect(rendererViewSource).toContain('mode-description');
    expect(rendererViewSource).toContain('Когда применять');
    expect(rendererViewSource).toContain('Кейсы');
    expect(rendererViewSource).not.toContain('disabled>Выход</button>');
    expect(readFileSync(join(appRoot, 'src', 'desktop-app-paths.ts'), 'utf-8')).toContain("'preload.cjs'");
  });

  it('resolves Electron assets from the app root during local dist launches', () => {
    const mainSource = readFileSync(join(appRoot, 'src', 'main.ts'), 'utf-8');

    expect(mainSource).toContain('resolveDesktopAppAssetPaths(app.getAppPath())');
    expect(mainSource).not.toContain("join(app.getAppPath(), 'src', 'index.html')");
    expect(mainSource).not.toContain("join(app.getAppPath(), 'dist', 'preload.cjs')");
  });

  it('keeps the desktop entry screen as a clean login before the control panel', () => {
    const html = readFileSync(join(appRoot, 'src', 'index.html'), 'utf-8');

    expect(html).toContain('data-auth-form');
    expect(html).toContain('data-window-titlebar');
    expect(html).toContain('data-window-control="minimize"');
    expect(html).toContain('data-window-control="maximize"');
    expect(html).toContain('data-window-control="close"');
    expect(html).toContain('data-login-screen');
    expect(html).toContain('data-app-shell hidden');
    expect(html).toContain('data-nav-section="start"');
    expect(html).toContain('data-checklist');
    expect(html).toContain('data-download-config');
    expect(html).toContain('data-start-prompt');
    expect(html).toContain('data-service-action="check_update"');
    expect(html).toContain('data-service-action="update"');
    expect(html).toContain('data-bottom-console');
    expect(html).toContain('data-modes');
    expect(html).toContain('mode-stack');
    expect(html).not.toContain('data-nav-section="mcp"');
    expect(html).not.toContain('data-section="mcp"');
    expect(html).not.toContain('data-nav-section="diagnostics"');
    expect(html).not.toContain('data-section="diagnostics"');
    expect(html).not.toContain('data-nav-section="settings"');
    expect(html).not.toContain('data-section="settings"');
    expect(html).not.toContain('data-mcp-diff');
    expect(html).not.toContain('>Конфиг<');
    expect(html).not.toContain('>Диагностика<');
    expect(html).not.toContain('>Настройки<');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).not.toContain('Зарегистрироваться');
    expect(html).not.toContain('Подключите watcher');
  });

  it('keeps project block buttons aligned without text wrapping', () => {
    const baseCss = readFileSync(join(appRoot, 'src', 'styles', 'base.css'), 'utf-8');
    const layoutCss = readFileSync(join(appRoot, 'src', 'styles', 'layout.css'), 'utf-8');
    const componentsCss = readFileSync(join(appRoot, 'src', 'styles', 'components.css'), 'utf-8');

    expect(baseCss).toContain('display: inline-flex;');
    expect(baseCss).toContain('white-space: nowrap;');
    expect(baseCss).toMatch(/body\s*\{[\s\S]*color:\s*var\(--ink\)/);
    expect(layoutCss).toContain('.project-picker > button');
    expect(layoutCss).toContain('.project-picker label');
    expect(layoutCss).toContain('margin-bottom: 0;');
    expect(layoutCss).toContain('.topbar-actions > button');
    expect(layoutCss).toContain('.topbar-actions .overall-badge');
    expect(layoutCss).toContain('.window-titlebar');
    expect(layoutCss).toContain('-webkit-app-region: drag;');
    expect(layoutCss).toContain('-webkit-app-region: no-drag;');
    expect(layoutCss).toContain('align-items: end;');
    expect(componentsCss).toContain('width: 100%;');
    expect(componentsCss).toContain('.window-logo');
    expect(componentsCss).toContain('repeat(auto-fit, minmax(210px, 1fr))');
  });

  it('declares an isolated package for the desktop application', () => {
    const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.scripts?.build).toBe('tsc -p tsconfig.json');
    expect(packageJson.scripts?.start).toContain('electron dist/main.js');
    expect(packageJson.scripts?.dist).toContain('electron-builder --win nsis --x64');
    expect(JSON.stringify(packageJson)).toContain('"nsis"');
    expect(JSON.stringify(packageJson)).toContain('"runAfterFinish":true');
    expect(JSON.stringify(packageJson)).not.toContain('"portable"');
    expect(JSON.stringify(packageJson)).toContain('src/styles/**/*');
    expect(JSON.stringify(packageJson)).toContain('src/app-icon.png');
    expect(JSON.stringify(packageJson)).toContain('build/icon.png');
    expect(packageJson.dependencies?.electron).toBeUndefined();
    expect(packageJson.dependencies?.['project-brain-mcp']).toBeUndefined();
    expect(packageJson.devDependencies?.electron).toBeDefined();
  });

  it('keeps watcher native sqlite dependency outside the ESM bundle', () => {
    const watcherPackage = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as {
      files?: readonly string[];
      dependencies?: Record<string, string>;
    };

    expect(watcherPackage.files).toContain('bin/watcher.js');
    expect(watcherPackage.files).toContain('bin/run-watcher.js');
    expect(watcherPackage.dependencies?.['better-sqlite3']).toBeDefined();
  });

  it('starts service actions through the current watcher release', () => {
    const serviceRunnerSource = readFileSync(join(appRoot, 'src', 'desktop-service-runner.ts'), 'utf-8');
    const watcherPackage = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as {
      version?: string;
    };

    expect(serviceRunnerSource).toContain(`project-brain-watcher#v${watcherPackage.version}`);
    expect(serviceRunnerSource).toContain("'desktop', 'update'");
    expect(serviceRunnerSource).toContain("'service', 'install'");
    expect(serviceRunnerSource).toContain("'service', 'restart'");
    expect(serviceRunnerSource).not.toContain('project-brain-watcher#v1.4.4');
    expect(serviceRunnerSource).toContain("'cmd.exe'");
    expect(serviceRunnerSource).toContain("'/d', '/s', '/c'");
  });

  it('keeps generated service launches on the current watcher release with explicit takeover', () => {
    const watcherBundle = readFileSync(join(process.cwd(), 'bin', 'watcher.js'), 'utf-8');
    const watcherPackage = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as {
      version?: string;
    };

    expect(watcherBundle).toContain(`"v${watcherPackage.version}"`);
    expect(watcherBundle).not.toContain('"v1.4.4"');
    expect(watcherBundle).toContain('"--watch","--replace"');
  });

  it('keeps service npx cache under the project service directory', () => {
    const watcherBundle = readFileSync(join(process.cwd(), 'bin', 'watcher.js'), 'utf-8');

    expect(watcherBundle).toContain('NPM_CONFIG_CACHE');
    expect(watcherBundle).toContain('npm_config_cache');
    expect(watcherBundle).toContain('NO_UPDATE_NOTIFIER');
    expect(watcherBundle).toContain('npm-cache');
  });

  it('recovers a watcher lease owner mismatch before stopping the service process', () => {
    const watcherBundle = readFileSync(join(process.cwd(), 'bin', 'watcher.js'), 'utf-8');

    expect(watcherBundle).toContain('Watcher lease mismatch');
    expect(watcherBundle).toContain('Watcher lease reacquired');
    expect(watcherBundle).toContain('lease owner mismatch');
    expect(watcherBundle).toContain('replace:!0');
  });

  it('reports warm delta verification against the retained index coverage', () => {
    const watcherBundle = readFileSync(join(process.cwd(), 'bin', 'watcher.js'), 'utf-8');

    expect(watcherBundle).toContain('mode==="warm_delta"');
    expect(watcherBundle).toContain('currentPaths.length');
    expect(watcherBundle).not.toContain('compressed:me.length');
  });
});
