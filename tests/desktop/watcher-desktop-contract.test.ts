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
    expect(contractsSource).toContain('readonly aliases?: readonly string[]');
    expect(contractsSource).toContain('readonly confusionGuard?: string');
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
    expect(rendererViewSource).toContain('data-mode-select');
    expect(rendererViewSource).toContain('data-mode-select-menu');
    expect(rendererViewSource).toContain('data-mode-option');
    expect(rendererViewSource).toContain('data-mode-step="prev"');
    expect(rendererViewSource).toContain('data-mode-step="next"');
    expect(rendererViewSource).toContain('mode-carousel');
    expect(rendererViewSource).toContain('mode-description');
    expect(rendererViewSource).toContain('Триггеры');
    expect(rendererViewSource).toContain('Не путать');
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
    expect(html).toContain('class="icon-button" data-copy-prompt aria-label="Копировать промт"');
    expect(html).toContain('class="code-block prompt-code-block" data-start-prompt');
    expect(html).toContain('data-service-action="check_update"');
    expect(html).toContain('data-service-action="update"');
    expect(html).toContain('data-bottom-console');
    expect(html).toContain('class="ghost icon-button" data-select-root');
    expect(html).toContain('class="icon-button" data-download-config');
    expect(html).toContain('class="ghost icon-button" data-toggle-theme');
    expect(html).toContain('class="ghost icon-button" data-console-toggle');
    expect(html).toContain('data-project-picker data-custom-select');
    expect(html).toContain('data-floating-tooltip');
    expect(html).toContain('data-project-select-button');
    expect(html).toContain('data-project-select-menu role="listbox"');
    expect(html).toContain('data-tooltip="Открыть список проектов"');
    expect(html).toContain('data-tooltip="Выбрать папку проекта"');
    expect(html).toContain('data-tooltip="Скачать файл настройки MCP"');
    expect(html).toContain('data-tooltip="Проверить MCP-сервер, ключ доступа и состояние watcher"');
    expect(html).toContain('class="icon-button" data-run-full-check aria-label="Проверить подключение"');
    expect(html).toContain('aria-label="Выбрать папку"');
    expect(html).toContain('aria-label="Скачать файл настройки"');
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
    const html = readFileSync(join(appRoot, 'src', 'index.html'), 'utf-8');
    const baseCss = readFileSync(join(appRoot, 'src', 'styles', 'base.css'), 'utf-8');
    const layoutCss = readFileSync(join(appRoot, 'src', 'styles', 'layout.css'), 'utf-8');
    const componentsCss = readFileSync(join(appRoot, 'src', 'styles', 'components.css'), 'utf-8');
    const topbarHtml = html.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0] ?? '';

    expect(topbarHtml).not.toContain('data-open-service-logs');
    expect(topbarHtml).not.toContain('data-select-root>Выбрать папку');
    expect(topbarHtml).not.toContain('data-download-config>Скачать файл настройки');
    expect(topbarHtml).toContain('class="custom-select-field project-select-field"');
    expect(topbarHtml).toContain('data-custom-select-toggle data-project-select-button');
    expect(topbarHtml).toContain('data-project-select-menu role="listbox"');
    expect(topbarHtml).toContain('aria-label="Выбрать папку"');
    expect(topbarHtml).toContain('aria-label="Скачать файл настройки"');
    expect(baseCss).toContain('display: inline-flex;');
    expect(baseCss).toContain('white-space: nowrap;');
    expect(baseCss).toContain('select {\n  appearance: none;');
    expect(baseCss).toContain('-webkit-appearance: none;');
    expect(baseCss).toContain('select::-ms-expand');
    expect(baseCss).toContain('.native-select-fallback');
    expect(baseCss).toContain('--dropdown-panel: #fff;');
    expect(baseCss).toMatch(/body\s*\{[\s\S]*color:\s*var\(--ink\)/);
    expect(layoutCss).toContain('.project-picker > button');
    expect(layoutCss).toContain('.project-picker > .icon-button');
    expect(layoutCss).toContain('.project-select-field');
    expect(layoutCss).not.toContain('.project-picker label::after');
    expect(layoutCss).toContain('grid-template-columns: minmax(260px, 1fr) repeat(3, 42px);');
    expect(layoutCss).toContain('.topbar-actions > [data-download-config]');
    expect(layoutCss).toContain('.topbar-actions > [data-toggle-theme]');
    expect(layoutCss).toContain('margin-bottom: 0;');
    expect(layoutCss).toContain('.topbar-actions > button');
    expect(layoutCss).toContain('.topbar-actions .overall-badge');
    expect(layoutCss).toContain('.window-titlebar');
    expect(layoutCss).toContain('-webkit-app-region: drag;');
    expect(layoutCss).toContain('-webkit-app-region: no-drag;');
    expect(layoutCss).toContain('align-items: end;');
    expect(componentsCss).toContain('.custom-select-trigger');
    expect(componentsCss).toContain('.custom-select-menu');
    expect(componentsCss).toContain('.custom-select-option[data-selected="true"]');
    expect(componentsCss).toContain('background: var(--dropdown-panel);');
    expect(componentsCss).toContain('.floating-tooltip');
    expect(componentsCss).toContain('.floating-tooltip[data-visible="true"]');
    expect(componentsCss).toContain('width: 100%;');
    expect(componentsCss).toContain('.window-logo');
    expect(componentsCss).toContain('.command-list button');
    expect(componentsCss).toContain('min-width: 180px;');
    expect(componentsCss).toContain('.command-list button[hidden]');
    expect(componentsCss).toContain('display: inline-flex;');
    expect(componentsCss).toContain('flex-wrap: nowrap;');
    expect(componentsCss).toContain('margin-top: 0;');
    expect(componentsCss).toContain('.overall-badge.service-summary-badge');
    expect(componentsCss).toContain('.prompt-code-block');
    expect(componentsCss).toContain('padding: 18px;');
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

  it('keeps the service watcher package free of native sqlite install dependencies', () => {
    const watcherPackage = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as {
      files?: readonly string[];
      dependencies?: Record<string, string>;
    };
    const watcherBundle = readFileSync(join(process.cwd(), 'bin', 'watcher.js'), 'utf-8');

    expect(watcherPackage.files).toContain('bin/watcher.js');
    expect(watcherPackage.files).toContain('bin/run-watcher.js');
    expect(watcherPackage.dependencies?.['better-sqlite3']).toBeUndefined();
    expect(watcherBundle).not.toContain('better-sqlite3');
    expect(watcherBundle).toContain('watcher-events.json');
    expect(watcherBundle).not.toContain('watcher-events.sqlite');
    expect(watcherBundle).not.toContain('durable SQLite');
  });

  it('starts service actions through the current watcher release', () => {
    const serviceRunnerSource = readFileSync(join(appRoot, 'src', 'desktop-service-runner.ts'), 'utf-8');
    const watcherPackage = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as {
      version?: string;
    };

    expect(serviceRunnerSource).toContain(`/releases/download/v${watcherPackage.version}/`);
    expect(serviceRunnerSource).toContain(`project-brain-watcher-${watcherPackage.version}.tgz`);
    expect(serviceRunnerSource).toContain("'desktop', 'update'");
    expect(serviceRunnerSource).toContain("'service', 'install'");
    expect(serviceRunnerSource).toContain("'service', 'restart'");
    expect(serviceRunnerSource).not.toContain('project-brain-watcher#v1.4.4');
    expect(serviceRunnerSource).not.toContain(`project-brain-watcher#v${watcherPackage.version}`);
    expect(serviceRunnerSource).toContain("'cmd.exe'");
    expect(serviceRunnerSource).toContain("'/d', '/s', '/c'");
  });

  it('installs service runtime through a local node package instead of npx runtime installs', () => {
    const serviceRunnerSource = readFileSync(join(appRoot, 'src', 'desktop-service-runner.ts'), 'utf-8');

    expect(serviceRunnerSource).toContain("'--service-runner'");
    expect(serviceRunnerSource).toContain("'node'");
    expect(serviceRunnerSource).toContain("'--watcher-entry'");
    expect(serviceRunnerSource).toContain('serviceWatcherEntry(profile)');
    expect(serviceRunnerSource).toContain("'runtime-entry.cjs'");
    expect(serviceRunnerSource).not.toContain("return ['--path',");
  });

  it('routes normal service mutations through the local node runtime arguments', () => {
    const serviceRunnerSource = readFileSync(join(appRoot, 'src', 'desktop-service-runner.ts'), 'utf-8');

    expect(serviceRunnerSource).toContain('buildServiceActionArgs(request.action, profile)');
    expect(serviceRunnerSource).toContain("return ['--yes', WATCHER_PACKAGE, 'service', action, ...serviceArgs(profile)]");
    expect(serviceRunnerSource).not.toContain("'service',\n    action,\n    '--path'");
  });

  it('materializes the node service runtime during service install', () => {
    const watcherBundle = readFileSync(join(process.cwd(), 'bin', 'watcher.js'), 'utf-8');

    expect(watcherBundle).toContain('Service node runtime установлен');
    expect(watcherBundle).toContain('Service node runtime entry создан');
    expect(watcherBundle).toContain('cmd.exe');
    expect(watcherBundle).toContain('npm.cmd');
    expect(watcherBundle).toContain('"install","--prefix"');
    expect(watcherBundle).toContain('npxPackage');
    expect(watcherBundle).toContain('watcherEntry');
    expect(watcherBundle).toContain('runtime-install.log');
    expect(watcherBundle).toContain('runtime-staging');
    expect(watcherBundle).toContain('runtime-entry.cjs');
    expect(watcherBundle).toContain('active-runtime.json');
    expect(watcherBundle).toContain('active_entry');
    expect(watcherBundle).toContain('attempt_runtime_dir');
    expect(watcherBundle).toContain('attempt_npm_cache');
    expect(watcherBundle).toContain('exit_code');
    expect(watcherBundle).toContain('--- stdout ---');
    expect(watcherBundle).toContain('--- stderr ---');
    expect(watcherBundle).toContain('github:horggorg88-pixel\\/project-brain-watcher#v');
    expect(watcherBundle).toContain('releases/download/v');
    expect(watcherBundle).toContain('project-brain-watcher-');
  });

  it('repairs existing service metadata before start and update flows', () => {
    const serviceRunnerSource = readFileSync(join(appRoot, 'src', 'desktop-service-runner.ts'), 'utf-8');

    expect(serviceRunnerSource).toContain('readServiceLauncherRepairState');
    expect(serviceRunnerSource).toContain('shouldRepairServiceLauncherBeforeAction');
    expect(serviceRunnerSource).toContain('normalizeServiceInstallResult');
    expect(serviceRunnerSource).toContain('buildServiceRefreshArgs');
    expect(serviceRunnerSource).toContain('service repair: launcher устарел');
    expect(serviceRunnerSource).toContain('service repair: install already exists');
    expect(serviceRunnerSource).toContain('service repair: refresh');
  });

  it('exposes passive service status and copy logs in the watcher panel', () => {
    const html = readFileSync(join(appRoot, 'src', 'index.html'), 'utf-8');
    const rendererSource = readFileSync(join(appRoot, 'src', 'renderer.ts'), 'utf-8');
    const serviceUiSource = readFileSync(join(appRoot, 'src', 'renderer-service-ui.ts'), 'utf-8');
    const layoutCss = readFileSync(join(appRoot, 'src', 'styles', 'layout.css'), 'utf-8');
    const componentsCss = readFileSync(join(appRoot, 'src', 'styles', 'components.css'), 'utf-8');
    const watcherSectionHtml = html.match(/<section class="content-section" data-section="watcher"[\s\S]*?<\/section>/)?.[0] ?? '';

    expect(html).toContain('data-copy-service-logs');
    expect(html).toContain('data-console-toggle');
    expect(html).toContain('class="ghost icon-button" data-copy-service-logs');
    expect(html).toContain('class="icon-button service-icon-button" data-service-action="health"');
    expect(watcherSectionHtml).not.toContain('>Проверить подключение</button>');
    expect(watcherSectionHtml).not.toContain('>Копировать логи</button>');
    expect(watcherSectionHtml).not.toContain('data-open-service-logs');
    expect(html).toContain('class="section-head service-head"');
    expect(html).toContain('class="service-toolbar"');
    expect(html).toContain('class="overall-badge service-summary-badge"');
    expect(html).toContain('class="command-list service-command-grid"');
    expect(html).toContain('class="code-block service-status-output"');
    expect(watcherSectionHtml.indexOf('data-service-summary')).toBeLessThan(watcherSectionHtml.indexOf('data-service-action="install"'));
    expect(watcherSectionHtml.indexOf('data-service-action="health"')).toBeLessThan(watcherSectionHtml.indexOf('data-copy-service-logs'));
    expect(rendererSource).toContain('copyServiceLogsButton');
    expect(serviceUiSource).toContain('serviceActionTooltip');
    expect(serviceUiSource).toContain('serviceActionIcon');
    expect(serviceUiSource).toContain('button.innerHTML = serviceActionIcon(action)');
    expect(serviceUiSource).toContain("button.setAttribute('aria-label', label)");
    expect(serviceUiSource).toContain('button.dataset.tooltip');
    expect(serviceUiSource).toContain('Проверить MCP-доступ и состояние службы без изменений');
    expect(serviceUiSource).toContain('Установить Windows-службу watcher для выбранного проекта');
    expect(html).toContain('data-tooltip="Скопировать статус службы и последние логи watcher"');
    expect(rendererSource).not.toContain('openServiceLogsButtons');
    expect(rendererSource).toContain('serviceLogsText');
    expect(rendererSource).toContain('renderConsoleToggle');
    expect(rendererSource).toContain('chevronDownIcon');
    expect(rendererSource).toContain('Логи службы скопированы');
    expect(rendererSource).toContain("bottomConsoleEl?.toggleAttribute('data-collapsed'");
    expect(rendererSource).not.toContain("bottomConsoleEl?.toggleAttribute('hidden'");
    expect(layoutCss).toContain('.bottom-console[data-collapsed]');
    expect(layoutCss).toContain('.bottom-console .icon-button');
    expect(layoutCss).toContain('.bottom-console .ghost');
    expect(layoutCss).toContain('color: var(--inverse-ink)');
    expect(layoutCss).toContain('.service-toolbar');
    expect(layoutCss).toContain('.service-summary-badge');
    expect(layoutCss).toContain('grid-template-columns: minmax(150px, 0.7fr) minmax(0, 1.8fr);');
    expect(layoutCss).toContain('.service-status-output');
    expect(componentsCss).toContain('cursor: default;');
    expect(componentsCss).toContain('pointer-events: none;');
    expect(componentsCss).toContain('border-left: 3px solid var(--line-strong);');
    expect(componentsCss).toContain('.service-command-grid');
    expect(componentsCss).toContain('display: inline-flex;');
    expect(componentsCss).toContain('flex-wrap: nowrap;');
    expect(componentsCss).toContain('margin-top: 0;');
    expect(componentsCss).toContain('.overall-badge.service-summary-badge');
  });

  it('keeps modes browsable through a single card selector and uses plain dark surfaces', () => {
    const rendererSource = readFileSync(join(appRoot, 'src', 'renderer.ts'), 'utf-8');
    const rendererViewSource = readFileSync(join(appRoot, 'src', 'renderer-view.ts'), 'utf-8');
    const layoutCss = readFileSync(join(appRoot, 'src', 'styles', 'layout.css'), 'utf-8');
    const themesCss = readFileSync(join(appRoot, 'src', 'styles', 'themes.css'), 'utf-8');

    expect(rendererSource).toContain('activeModeId');
    expect(rendererSource).toContain('stepActiveMode');
    expect(rendererSource).toContain('toggleCustomSelect');
    expect(rendererSource).toContain('selectProjectOption');
    expect(rendererSource).toContain('selectModeOption');
    expect(rendererSource).toContain('button.dataset.tooltip = label');
    expect(rendererSource).toContain('showTooltipFromTarget');
    expect(rendererSource).toContain('positionTooltip');
    expect(rendererSource).toContain('renderThemeToggle');
    expect(rendererSource).toContain('moonIcon');
    expect(rendererSource).toContain('sunIcon');
    expect(rendererViewSource).toContain('data-mode-browser');
    expect(rendererViewSource).toContain('data-mode-select');
    expect(rendererViewSource).toContain('data-custom-select-toggle data-mode-select-button');
    expect(rendererViewSource).toContain('data-tooltip="Открыть список режимов"');
    expect(rendererViewSource).toContain('checkActionTooltip');
    expect(rendererViewSource).toContain('role="listbox"');
    expect(rendererViewSource).not.toContain('mode-grid');
    expect(layoutCss).toContain('.mode-browser');
    expect(layoutCss).toContain('.mode-select-label');
    expect(layoutCss).toContain('.mode-carousel');
    expect(themesCss).toContain('background: var(--bg);');
    expect(themesCss).toContain('--dropdown-panel: #1b1b19;');
    expect(themesCss).toContain('body[data-theme="dark"] .custom-select-menu');
    expect(themesCss).toContain('body[data-theme="dark"] .custom-select-trigger');
    expect(themesCss).toContain('body[data-theme="dark"] .custom-select-option');
    expect(themesCss).toContain('body[data-theme="dark"] .custom-select-option[data-selected="true"]');
    expect(themesCss).toContain('body[data-theme="dark"] .custom-select-option[data-selected="true"]:hover');
    expect(themesCss).toContain('color: var(--ink);');
    expect(themesCss).not.toContain('body[data-theme="dark"] .project-picker select');
    expect(themesCss).not.toContain('body[data-theme="dark"] .window-titlebar {\n  background: rgba');
  });

  it('keeps the mode legend explicit about wavy aliases and Idol as an MCP mode', () => {
    const modeCatalogSource = readFileSync(join(appRoot, 'src', 'desktop-mode-catalog.ts'), 'utf-8');
    const configPackageSource = readFileSync(join(appRoot, 'src', 'desktop-config-package.ts'), 'utf-8');

    expect(modeCatalogSource).toContain('wavy');
    expect(modeCatalogSource).toContain('вейви');
    expect(modeCatalogSource).toContain('IDOL не внешняя шкала');
    expect(modeCatalogSource).toContain('operator_workflow:idol');
    expect(configPackageSource).toContain('Лёгкая легенда MCP-режимов');
    expect(configPackageSource).toContain('wave / wavy / вейви');
    expect(configPackageSource).toContain('idol / идол');
    expect(configPackageSource).toContain('IDOL не внешняя шкала');
  });

  it('gives desktop self-update enough time and launches the downloaded installer', () => {
    const serviceRunnerSource = readFileSync(join(appRoot, 'src', 'desktop-service-runner.ts'), 'utf-8');

    expect(serviceRunnerSource).toContain('DESKTOP_UPDATE_TIMEOUT_MS');
    expect(serviceRunnerSource).toContain('timeoutLabel: \'desktop update\'');
    expect(serviceRunnerSource).toContain("'desktop', 'update', '--open'");
    expect(serviceRunnerSource).toContain('Команда прервана по таймауту');
  });

  it('keeps generated service launches on the current watcher release with explicit takeover', () => {
    const watcherBundle = readFileSync(join(process.cwd(), 'bin', 'watcher.js'), 'utf-8');
    const watcherPackage = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as {
      version?: string;
    };

    expect(watcherBundle).toContain(String(watcherPackage.version));
    expect(watcherBundle).toContain('project-brain-watcher-');
    expect(watcherBundle).toContain(`/releases/download/v`);
    expect(watcherBundle).not.toContain('"v1.4.4"');
    expect(watcherBundle).toContain('"--watch","--replace"');
    expect(watcherBundle).toContain('"refresh"');
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
