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
    expect(mainSource).toContain('window.show()');
    expect(mainSource).toContain('window.focus()');
    expect(mainSource).toContain("window.webContents.openDevTools({ mode: 'detach' })");
    expect(mainSource).toContain('Menu.setApplicationMenu(null)');
    expect(mainSource).toContain("process.env.PROJECT_BRAIN_DESKTOP_DEBUG === '1'");
    expect(mainSource).toContain("process.env.PROJECT_BRAIN_DESKTOP_DEVTOOLS === '1'");
    expect(mainSource).toContain('PROJECT_BRAIN_DESKTOP_USER_DATA_DIR');
    expect(mainSource).not.toContain('nativeImage.createEmpty()');
    expect(mainSource).toContain('if (!existsSync(iconPath)) return null');
  });

  it('exposes typed preload APIs without raw ipcRenderer forwarding', () => {
    const preloadSource = readFileSync(join(appRoot, 'src', 'preload.cts'), 'utf-8');
    const contractsSource = readFileSync(join(appRoot, 'src', 'contracts.ts'), 'utf-8');
    const rendererSource = readFileSync(join(appRoot, 'src', 'renderer.ts'), 'utf-8');

    expect(preloadSource).toContain("contextBridge.exposeInMainWorld('watcherDesktop'");
    expect(preloadSource).toContain("ipcRenderer.invoke('access:login'");
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
    expect(contractsSource).not.toContain('readonly serverVerified?: boolean');
    expect(contractsSource).toContain('buildConfigPackage(projectId: string)');
    expect(contractsSource).toContain('fullCheck(projectId: string)');
    expect(rendererSource).toContain('service.fullCheck');
    expect(readFileSync(join(appRoot, 'src', 'main.ts'), 'utf-8')).toContain("'preload.cjs'");
  });

  it('keeps the desktop entry screen as a clean login before the control panel', () => {
    const html = readFileSync(join(appRoot, 'src', 'index.html'), 'utf-8');

    expect(html).toContain('data-auth-form');
    expect(html).toContain('data-login-screen');
    expect(html).toContain('data-app-shell hidden');
    expect(html).toContain('data-nav-section="start"');
    expect(html).toContain('data-checklist');
    expect(html).toContain('data-download-config');
    expect(html).toContain('data-start-prompt');
    expect(html).toContain('data-bottom-console');
    expect(html).toContain('data-modes');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).not.toContain('Зарегистрироваться');
    expect(html).not.toContain('Подключите watcher');
  });

  it('declares an isolated package for the desktop application', () => {
    const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.scripts?.build).toBe('tsc -p tsconfig.json');
    expect(packageJson.scripts?.start).toContain('electron dist/main.js');
    expect(packageJson.scripts?.dist).toContain('electron-builder');
    expect(JSON.stringify(packageJson)).toContain('src/styles/**/*');
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

  it('starts service actions through the pinned watcher release', () => {
    const serviceRunnerSource = readFileSync(join(appRoot, 'src', 'desktop-service-runner.ts'), 'utf-8');
    const watcherPackage = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as {
      version?: string;
    };

    expect(serviceRunnerSource).toContain(`project-brain-watcher#v${watcherPackage.version}`);
  });
});
