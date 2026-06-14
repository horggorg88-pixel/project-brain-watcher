import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loginAccess, logoutAccess, readAccessState } from '../../apps/watcher-desktop/src/desktop-access.js';
import { resolveDesktopAppAssetPaths } from '../../apps/watcher-desktop/src/desktop-app-paths.js';
import { buildDesktopConfigPackage } from '../../apps/watcher-desktop/src/desktop-config-package.js';
import { buildDesktopConnectionCheck } from '../../apps/watcher-desktop/src/desktop-connection-check.js';
import { importProjectConfig } from '../../apps/watcher-desktop/src/desktop-config-import.js';
import { discoverMcpConfig } from '../../apps/watcher-desktop/src/desktop-config-discovery.js';
import { listDesktopModeSummaries } from '../../apps/watcher-desktop/src/desktop-mode-summary.js';
import {
  readProfiles,
  readServiceStatus,
  runServiceAction,
  saveProfile,
  listDesktopProjectProfiles,
  previewDiagnostics,
  type DesktopCorePaths,
} from '../../apps/watcher-desktop/src/desktop-core.js';
import { readDesktopServiceSecret, readDesktopServiceSecretState } from '../../apps/watcher-desktop/src/desktop-service-secret.js';
import { stageDesktopServiceSecret } from '../../apps/watcher-desktop/src/desktop-service-secret.js';
import { isServiceActionSettled, prepareServiceSecretForLaunch, resolveVerifiedServiceActionToken, summarizeServiceActionSettlement } from '../../apps/watcher-desktop/src/desktop-service-runner.js';
import { parseWindowsServiceConfigOutput, parseWindowsServiceOutput } from '../../apps/watcher-desktop/src/desktop-service-status.js';
import { readDesktopUiState, saveDesktopUiState } from '../../apps/watcher-desktop/src/desktop-ui-state.js';
import { defaultProfile, serviceName } from '../../apps/watcher-desktop/src/desktop-profile-store.js';
import type { WatcherServiceStatus } from '../../apps/watcher-desktop/src/contracts.js';

const tempDirs: string[] = [];
const VALID_TEST_BEARER = 'valid_test_bearer_12345678901234567890';
const VALID_ENV_BEARER = 'valid_env_bearer_12345678901234567890';
const PLACEHOLDER_BEARER = 'pb_secret_value';
const STALE_LOCAL_BEARER = 'stale_local_bearer_123456789012345678';

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('watcher desktop core', () => {
  it('resolves source assets correctly when Electron starts from dist/main.js', () => {
    const appRoot = join(tmpdir(), 'watcher-desktop');
    const paths = resolveDesktopAppAssetPaths(join(appRoot, 'dist'));

    expect(paths.rootPath).toBe(appRoot);
    expect(paths.indexHtmlPath).toBe(join(appRoot, 'src', 'index.html'));
    expect(paths.preloadPath).toBe(join(appRoot, 'dist', 'preload.cjs'));
    expect(paths.appIconPath).toBe(join(appRoot, 'src', 'app-icon.png'));
    expect(paths.trayIconPath).toBe(join(appRoot, 'src', 'app-icon.png'));
  });

  it('keeps packaged Electron app paths rooted at the packaged app path', () => {
    const appRoot = join(tmpdir(), 'app.asar');
    const paths = resolveDesktopAppAssetPaths(appRoot);

    expect(paths.rootPath).toBe(appRoot);
    expect(paths.indexHtmlPath).toBe(join(appRoot, 'src', 'index.html'));
    expect(paths.preloadPath).toBe(join(appRoot, 'dist', 'preload.cjs'));
    expect(paths.appIconPath).toBe(join(appRoot, 'src', 'app-icon.png'));
    expect(paths.trayIconPath).toBe(join(appRoot, 'src', 'app-icon.png'));
  });

  it('saves normalized project profiles without storing bearer values', () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'repo');
    mkdirSync(root, { recursive: true });

    const saved = saveProfile(paths, {
      id: ' demo ',
      name: ' Demo ',
      root,
      indexId: ' idx-demo ',
      serverUrl: 'https://brain.example/',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });

    expect(saved.id).toBe('demo');
    expect(saved.serverUrl).toBe('https://brain.example');
    expect(JSON.stringify(readProfiles(paths))).not.toContain('Bearer ');
  });

  it('stores base MCP server URL when a new profile starts from an existing project route', () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'HyinahiTEst');
    mkdirSync(root, { recursive: true });

    const saved = saveProfile(paths, {
      id: 'hyinahitest',
      name: 'HyinahiTEst',
      root,
      indexId: 'idx-hyinahitest',
      serverUrl: 'http://149.33.14.250/mcp/p/mcp-monorepo',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });

    expect(saved.serverUrl).toBe('http://149.33.14.250');
    expect(readProfiles(paths)[0]?.serverUrl).toBe('http://149.33.14.250');
  });

  it('uses the authorized account bearer when creating a project config from the desktop control panel', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'Client Project');
    mkdirSync(root, { recursive: true });
    const requestedUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrls.push(String(input));
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
      if (String(input) === 'http://149.33.14.250/api/auth/access') {
        expect(body.email).toBe('client@example.com');
        expect(body.password).toBe('password123');
        return new Response(JSON.stringify({
          ok: true,
          profile: { firstName: 'Client', lastName: 'User', email: 'client@example.com', role: 'user' },
          serverConfig: {
            projectPath: '',
            projectId: '',
            serverUrl: 'http://149.33.14.250',
            bearerToken: VALID_TEST_BEARER,
            tokenEnv: 'MCP_BEARER_TOKEN',
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return verifiedMcpFetch()(input, init);
    }));

    const state = await loginAccess(paths, { email: 'client@example.com', password: 'password123' });
    const saved = saveProfile(paths, {
      id: 'client-project',
      name: 'Client Project',
      root,
      indexId: 'idx-client-project',
      serverUrl: '',
      tokenEnv: '',
    });
    const pack = buildDesktopConfigPackage(paths, 'client-project', { bootstrap: true });
    const brainMcp = JSON.parse(readFileSync(join(root, '.brain', 'mcp.json'), 'utf-8')) as {
      readonly mcpServers?: Record<string, { readonly headers?: Record<string, string> }>;
    };

    expect(state.signedIn).toBe(true);
    expect(requestedUrls).toContain('http://149.33.14.250/api/auth/access');
    expect(saved.serverUrl).toBe('http://149.33.14.250');
    expect(readDesktopServiceSecret(saved)).toBe(VALID_TEST_BEARER);
    expect(pack.configJson).toContain(`Bearer ${VALID_TEST_BEARER}`);
    expect(brainMcp.mcpServers?.['project-brain']?.headers?.Authorization).toBe(`Bearer ${VALID_TEST_BEARER}`);
  });

  it('blocks project package bootstrap when no concrete bearer is available', () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'Client Project');
    mkdirSync(root, { recursive: true });
    vi.stubEnv('MCP_BEARER_TOKEN', '');

    const profile = saveProfile(paths, {
      id: 'client-project',
      name: 'Client Project',
      root,
      indexId: 'idx-client-project',
      serverUrl: 'http://149.33.14.250',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });
    const pack = buildDesktopConfigPackage(paths, 'client-project');

    expect(pack.tokenAvailable).toBe(false);
    expect(existsSync(join(root, '.brain', 'mcp.json'))).toBe(false);
    expect(() => buildDesktopConfigPackage(paths, 'client-project', { bootstrap: true }))
      .toThrow(/Bearer для MCP_BEARER_TOKEN не найден/);
  });

  it('repairs a stale placeholder project package after account login returns a bearer', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'HyinahiTEst');
    mkdirSync(join(root, '.brain'), { recursive: true });
    vi.stubEnv('MCP_BEARER_TOKEN', '');
    const profile = saveProfile(paths, {
      id: 'hyinahitest',
      name: 'HyinahiTEst',
      root,
      indexId: 'idx-hyinahitest',
      serverUrl: 'http://149.33.14.250',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });
    writeFileSync(join(root, '.brain', 'mcp.json'), JSON.stringify({
      project_id: 'hyinahitest',
      endpoint: 'http://149.33.14.250/mcp/p/hyinahitest',
      mcpServers: {
        'project-brain': {
          url: 'http://149.33.14.250/mcp/p/hyinahitest',
          headers: { Authorization: 'Bearer ${MCP_BEARER_TOKEN}' },
        },
      },
    }), 'utf-8');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === 'http://149.33.14.250/api/auth/access') {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
        expect(body.email).toBe('client@example.com');
        expect(body.password).toBe('password123');
        return new Response(JSON.stringify({
          ok: true,
          serverConfig: {
            serverUrl: 'http://149.33.14.250',
            bearerToken: VALID_TEST_BEARER,
            tokenEnv: 'MCP_BEARER_TOKEN',
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return verifiedMcpFetch()(input, init);
    }));

    const state = await loginAccess(paths, { email: 'client@example.com', password: 'password123' });
    const pack = buildDesktopConfigPackage(paths, 'hyinahitest', { bootstrap: true });
    const brainMcp = JSON.parse(readFileSync(join(root, '.brain', 'mcp.json'), 'utf-8')) as {
      readonly mcpServers?: Record<string, { readonly headers?: Record<string, string> }>;
    };

    expect(state.serverVerified).toBe(true);
    expect(readDesktopServiceSecret(profile)).toBe(VALID_TEST_BEARER);
    expect(pack.tokenAvailable).toBe(true);
    expect(pack.configJson).toContain(`Bearer ${VALID_TEST_BEARER}`);
    expect(brainMcp.mcpServers?.['project-brain']?.headers?.Authorization).toBe(`Bearer ${VALID_TEST_BEARER}`);
  });

  it('requires explicit confirmation before service actions', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'repo');
    mkdirSync(root, { recursive: true });
    saveProfile(paths, {
      id: 'demo',
      name: 'Demo',
      root,
      indexId: 'idx-demo',
      serverUrl: 'https://brain.example',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });

    const result = await runServiceAction(paths, { action: 'restart', projectId: 'demo', confirmed: false });

    expect(result.executed).toBe(false);
    expect(result.policy.decision).toBe('prompt');
    expect(result.exitCode).toBeNull();
  });

  it('reports a configured but stopped service without pretending it is healthy', () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'repo');
    mkdirSync(root, { recursive: true });
    saveProfile(paths, {
      id: 'demo',
      name: 'Demo',
      root,
      indexId: 'idx-demo',
      serverUrl: 'https://brain.example',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });

    const status = readServiceStatus(paths);

    expect(status.running).toBe(false);
    expect(status.health).toBe('not_configured');
    expect(status.lastError).toBe('Служба Watcher не запущена');
  });

  it('runs health checks without mutating the service', async () => {
    const paths = tempPaths();
    const result = await runServiceAction(paths, { action: 'health', projectId: 'demo', confirmed: false });

    expect(result.executed).toBe(false);
    expect(result.policy.decision).toBe('allow');
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Проверка не пройдена');
    expect(result.output).toContain('не запускалась и не перезапускалась');
  });

  it('parses localized Windows sc.exe output by numeric service state', () => {
    const status = parseWindowsServiceOutput([
      '        localized_type_label  : 10  WIN32_OWN_PROCESS',
      '        localized_state_label : 4  RUNNING',
      '        localized_exit_label  : 0  (0x0)',
    ].join('\n'));

    expect(status.installed).toBe(true);
    expect(status.running).toBe(true);
    expect(status.lastError).toBeNull();
  });

  it('parses Windows service binary path from sc.exe qc output', () => {
    const config = parseWindowsServiceConfigOutput([
      '[SC] QueryServiceConfig SUCCESS',
      'SERVICE_NAME: ProjectBrainWatcher-mcp-monorepo',
      '        BINARY_PATH_NAME   : "C:\\Users\\New\\Desktop\\MCP\\.brain\\service\\ProjectBrainWatcher-mcp-monorepo.exe"',
      '        SERVICE_START_NAME : LocalSystem',
    ].join('\n'));

    expect(config.binaryPath).toBe('C:\\Users\\New\\Desktop\\MCP\\.brain\\service\\ProjectBrainWatcher-mcp-monorepo.exe');
  });

  it('parses Windows service binary path from localized sc.exe qc output', () => {
    const config = parseWindowsServiceConfigOutput([
      '[SC] QueryServiceConfig: успех',
      'ИМЯ_СЛУЖБЫ: ProjectBrainWatcher-mcp-monorepo',
      '        ИМЯ_ДВОИЧНОГО_ФАЙЛА  : "C:\\Users\\New\\Desktop\\MCP\\.brain\\service\\ProjectBrainWatcher-mcp-monorepo.exe"',
      '        ИМЯ_ЗАПУСКА_СЛУЖБЫ    : LocalSystem',
    ].join('\n'));

    expect(config.binaryPath).toBe('C:\\Users\\New\\Desktop\\MCP\\.brain\\service\\ProjectBrainWatcher-mcp-monorepo.exe');
  });

  it('blocks start actions when a profile has no MCP server', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'repo');
    mkdirSync(root, { recursive: true });
    saveProfile(paths, {
      id: 'demo',
      name: 'Demo',
      root,
      indexId: 'idx-demo',
      serverUrl: '',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });

    const result = await runServiceAction(paths, { action: 'start', projectId: 'demo', confirmed: true });

    expect(result.executed).toBe(false);
    expect(result.policy.decision).toBe('deny');
    expect(result.output).toContain('MCP сервер не задан');
  });

  it('treats start on an already running watcher as a status check', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'repo');
    mkdirSync(join(root, '.brain'), { recursive: true });
    writeFileSync(join(root, '.brain', 'watcher-runtime.json'), JSON.stringify({
      owner: { project_id: 'demo', root, pid: process.pid },
      updated_at: Date.now(),
    }), 'utf-8');
    saveProfile(paths, {
      id: 'demo',
      name: 'Demo',
      root,
      indexId: 'idx-demo',
      serverUrl: '',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });

    const result = await runServiceAction(paths, { action: 'start', projectId: 'demo', confirmed: true });

    expect(result.executed).toBe(false);
    expect(result.policy.decision).toBe('allow');
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Watcher уже работает');
  });

  it('reads watcher service state for the selected project instead of the first profile', () => {
    const paths = tempPaths();
    const monorepoRoot = join(paths.homePath, 'MCP');
    const clientRoot = join(paths.homePath, 'Isolated Client Project');
    mkdirSync(join(monorepoRoot, '.brain'), { recursive: true });
    mkdirSync(clientRoot, { recursive: true });
    writeFileSync(join(monorepoRoot, '.brain', 'watcher-runtime.json'), JSON.stringify({
      owner: { project_id: 'alpha-running', root: monorepoRoot, pid: process.pid },
      updated_at: Date.now(),
    }), 'utf-8');
    saveProfile(paths, {
      id: 'alpha-running',
      name: 'Alpha Running',
      root: monorepoRoot,
      indexId: 'idx-mcp-monorepo',
      serverUrl: 'https://brain.example',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });
    saveProfile(paths, {
      id: 'hyinahitest',
      name: 'HyinahiTEst',
      root: clientRoot,
      indexId: 'idx-hyinahitest',
      serverUrl: 'https://brain.example',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });

    const defaultStatus = readServiceStatus(paths);
    const clientStatus = readServiceStatus(paths, 'hyinahitest');

    expect(defaultStatus.running).toBe(true);
    expect(defaultStatus.projectId).toBe('alpha-running');
    expect(clientStatus.running).toBe(false);
    expect(clientStatus.projectId).toBe('hyinahitest');
    expect(clientStatus.root).toBe(clientRoot);
  });

  it('does not skip selected-project start just because another profile is already running', async () => {
    const paths = tempPaths();
    const monorepoRoot = join(paths.homePath, 'MCP');
    const clientRoot = join(paths.homePath, 'HyinahiTEst');
    mkdirSync(join(monorepoRoot, '.brain'), { recursive: true });
    mkdirSync(clientRoot, { recursive: true });
    writeFileSync(join(monorepoRoot, '.brain', 'watcher-runtime.json'), JSON.stringify({
      owner: { project_id: 'alpha-running', root: monorepoRoot, pid: process.pid },
      updated_at: Date.now(),
    }), 'utf-8');
    saveProfile(paths, {
      id: 'alpha-running',
      name: 'Alpha Running',
      root: monorepoRoot,
      indexId: 'idx-mcp-monorepo',
      serverUrl: 'https://brain.example',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });
    saveProfile(paths, {
      id: 'hyinahitest',
      name: 'HyinahiTEst',
      root: clientRoot,
      indexId: 'idx-hyinahitest',
      serverUrl: '',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });

    const result = await runServiceAction(paths, { action: 'start', projectId: 'hyinahitest', confirmed: false });

    expect(result.executed).toBe(false);
    expect(result.policy.decision).toBe('prompt');
    expect(result.output).toContain('Подтвердите действие');
    expect(result.output).not.toContain('Watcher уже работает');
    expect(result.status.projectId).toBe('hyinahitest');
  });

  it('includes selected project service log tails without terminal escape noise', () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'HyinahiTEst');
    const serviceDir = join(root, '.brain', 'service');
    mkdirSync(serviceDir, { recursive: true });
    const profile = saveProfile(paths, {
      id: 'hyinahitest',
      name: 'HyinahiTEst',
      root,
      indexId: 'idx-hyinahitest',
      serverUrl: 'https://brain.example',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });
    const base = join(serviceDir, serviceName(profile.id));
    writeFileSync(`${base}.out.log`, '\u001B[92m✓\u001B[0m WATCH MODE\nLight audit: без изменений\n', 'utf-8');
    writeFileSync(`${base}.err.log`, 'npm warn deprecated prebuild-install\n', 'utf-8');
    writeFileSync(`${base}.wrapper.log`, 'Service started successfully.\nStarted process 24872\n', 'utf-8');

    const status = readServiceStatus(paths, 'hyinahitest');

    expect(status.logs?.out).toContain('WATCH MODE');
    expect(status.logs?.out).toContain('Light audit');
    expect(status.logs?.out).not.toContain('\u001B');
    expect(status.logs?.err).toContain('npm warn deprecated');
    expect(status.logs?.wrapper).toContain('Service started successfully');
    expect(status.logs?.wrapperPath).toBe(`${base}.wrapper.log`);
  });

  it('does not treat pending Windows service transitions as settled', () => {
    expect(isServiceActionSettled('stop', statusFixture({ running: false, lastError: 'Windows Service STOP_PENDING' }))).toBe(false);
    expect(isServiceActionSettled('start', statusFixture({ running: false, lastError: 'Windows Service START_PENDING' }))).toBe(false);
    expect(isServiceActionSettled('restart', statusFixture({ running: false, lastError: 'Windows Service STOP_PENDING' }))).toBe(false);
    expect(isServiceActionSettled('stop', statusFixture({ running: false, lastError: 'Windows Service STOPPED' }))).toBe(true);
    expect(isServiceActionSettled('start', statusFixture({ running: true, health: 'healthy', lastError: null }))).toBe(true);
  });

  it('reports failed service settlement when WinSW start exits before watcher becomes healthy', () => {
    const result = summarizeServiceActionSettlement(
      'start',
      0,
      'Service started successfully.',
      statusFixture({
        running: false,
        health: 'stopped',
        lastError: 'Windows Service STOPPED, WIN32_EXIT_CODE=1067',
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Service started successfully.');
    expect(result.output).toContain('Watcher не перешёл в healthy');
    expect(result.output).toContain('WIN32_EXIT_CODE=1067');
  });

  it('adds npx runtime diagnostics when a stopped service log shows npm cache cleanup warnings', () => {
    const result = summarizeServiceActionSettlement(
      'start',
      0,
      'Service started successfully.',
      statusFixture({
        running: false,
        health: 'stopped',
        lastError: 'Windows Service STOPPED, WIN32_EXIT_CODE=1067',
        logs: {
          errPath: 'C:\\repo\\.brain\\service\\ProjectBrainWatcher-demo.err.log',
          outPath: 'C:\\repo\\.brain\\service\\ProjectBrainWatcher-demo.out.log',
          wrapperPath: 'C:\\repo\\.brain\\service\\ProjectBrainWatcher-demo.wrapper.log',
          err: [
            'npm warn cleanup Failed to remove some directories',
            'C:\\repo\\.brain\\service\\npm-cache\\_npx\\59ff3b72c3b79437\\node_modules',
          ].join('\n'),
          out: '',
          wrapper: 'Service started successfully.',
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Диагностика службы');
    expect(result.output).toContain('launcher всё ещё запускает npx/npm');
    expect(result.output).toContain('.brain/service/runtime');
  });

  it('diagnoses the lbsclipnote field node service loop from Dmitry logs', () => {
    const result = summarizeServiceActionSettlement(
      'start',
      0,
      [
        'service repair: launcher устарел (launcher_missing_service_npm_cache, launcher_missing_update_notifier_guard)',
        'service repair: install already exists',
        'service repair: WinSW refresh недоступен в старый WinSW, launcher/XML обновлены, продолжаю запуск через start/restart.',
        'Service started successfully.',
      ].join('\n'),
      statusFixture({
        projectId: 'lbsclipnote',
        root: 'C:\\Jobka\\projects\\LBSCLIPNOTE_WORK\\LBSClipNote',
        running: false,
        health: 'stopped',
        lastError: 'Windows Service STOPPED, WIN32_EXIT_CODE=1067',
        logs: {
          errPath: 'C:\\Jobka\\projects\\LBSCLIPNOTE_WORK\\LBSClipNote\\.brain\\service\\ProjectBrainWatcher-lbsclipnote.err.log',
          outPath: 'C:\\Jobka\\projects\\LBSCLIPNOTE_WORK\\LBSClipNote\\.brain\\service\\ProjectBrainWatcher-lbsclipnote.out.log',
          wrapperPath: 'C:\\Jobka\\projects\\LBSCLIPNOTE_WORK\\LBSClipNote\\.brain\\service\\ProjectBrainWatcher-lbsclipnote.wrapper.log',
          err: [
            'npm warn deprecated prebuild-install@7.1.3',
            'npm warn cleanup Failed to remove some directories',
            'C:\\Jobka\\projects\\LBSCLIPNOTE_WORK\\LBSClipNote\\.brain\\service\\npm-cache\\_npx\\59ff3b72c3b79437\\node_modules',
            'Error: EPERM: operation not permitted, rmdir',
          ].join('\n'),
          out: '',
          wrapper: [
            'FATAL - Unhandled exception',
            'System.Exception: Unknown command: refresh',
            'A service with ID ProjectBrainWatcher-lbsclipnote already exists.',
          ].join('\n'),
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('field-node lbsclipnote');
    expect(result.output).toContain('C:\\Jobka\\projects\\LBSCLIPNOTE_WORK\\LBSClipNote');
    expect(result.output).toContain('install already exists не является причиной падения watcher');
    expect(result.output).toContain('refresh не поддерживается текущим WinSW');
    expect(result.output).toContain('EPERM cleanup в npm-cache');
    expect(result.output).toContain('.brain/service/runtime');
    expect(result.output).toContain('WIN32_EXIT_CODE=1067');
  });

  it('diagnoses stale Windows service metadata when wrapper logs point at another project root', () => {
    const result = summarizeServiceActionSettlement(
      'start',
      0,
      'Service started successfully.',
      statusFixture({
        projectId: 'mcp-monorepo',
        root: 'C:\\Users\\New\\Desktop\\mcp-monorepo',
        running: false,
        health: 'stopped',
        lastError: 'Windows Service STOPPED, WIN32_EXIT_CODE=1067',
        logs: {
          errPath: 'C:\\Users\\New\\Desktop\\mcp-monorepo\\.brain\\service\\ProjectBrainWatcher-mcp-monorepo.err.log',
          outPath: 'C:\\Users\\New\\Desktop\\mcp-monorepo\\.brain\\service\\ProjectBrainWatcher-mcp-monorepo.out.log',
          wrapperPath: 'C:\\Users\\New\\Desktop\\mcp-monorepo\\.brain\\service\\ProjectBrainWatcher-mcp-monorepo.wrapper.log',
          err: '',
          out: [
            'Путь:  C:\\Users\\New\\Desktop\\MCP',
            'Watcher lease rejected: Unauthorized',
          ].join('\n'),
          wrapper: [
            'Starting C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe "-NoProfile" "-File" "C:\\Users\\New\\Desktop\\MCP\\.brain\\service\\launch-watcher.ps1" "start" "--path" "C:\\Users\\New\\Desktop\\MCP"',
            'Started process 2456',
          ].join('\n'),
        },
      }),
    );

    expect(result.output).toContain('Windows service metadata указывает на другой root');
    expect(result.output).toContain('C:\\Users\\New\\Desktop\\MCP');
    expect(result.output).toContain('service secret не принят сервером');
  });

  it('stages the verified bearer into the service secret before launching the installed service', () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'repo');
    mkdirSync(root, { recursive: true });
    const profile = saveProfile(paths, {
      id: 'demo',
      name: 'Demo',
      root,
      indexId: 'idx-demo',
      serverUrl: 'https://brain.example',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });
    stageDesktopServiceSecret(profile, STALE_LOCAL_BEARER);

    const state = prepareServiceSecretForLaunch(profile, VALID_ENV_BEARER);

    expect(state.configured).toBe(true);
    expect(readDesktopServiceSecret(profile)).toBe(VALID_ENV_BEARER);
  });

  it('falls back to a verified environment bearer before service actions use a stale local secret', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'repo');
    mkdirSync(root, { recursive: true });
    const profile = saveProfile(paths, {
      id: 'demo',
      name: 'Demo',
      root,
      indexId: 'idx-demo',
      serverUrl: 'http://149.33.14.250',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });
    stageDesktopServiceSecret(profile, STALE_LOCAL_BEARER);
    vi.stubEnv('MCP_BEARER_TOKEN', VALID_ENV_BEARER);
    const authorizations: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('authorization') ?? '';
      authorizations.push(authorization);
      if (authorization !== `Bearer ${VALID_ENV_BEARER}`) return new Response('denied', { status: 401 });
      return verifiedMcpFetch()(input, init);
    }));

    const result = await resolveVerifiedServiceActionToken(profile, STALE_LOCAL_BEARER);

    expect(result.token).toBe(VALID_ENV_BEARER);
    expect(result.serverAccess.verified).toBe(true);
    expect(readDesktopServiceSecret(profile)).toBe(VALID_ENV_BEARER);
    expect(authorizations[0]).toBe(`Bearer ${STALE_LOCAL_BEARER}`);
    expect(authorizations[1]).toBe(`Bearer ${VALID_ENV_BEARER}`);
  });

  it('discovers an existing Codex MCP config without reading bearer values', () => {
    const paths = tempPaths();
    const codexDir = join(paths.homePath, '.codex');
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(join(codexDir, 'config.toml'), [
      '[mcp_servers.project-brain]',
      'bearer_token_env_var = "MCP_BEARER_TOKEN"',
      'url = "http://149.33.14.250/mcp"',
    ].join('\n'), 'utf-8');

    const config = discoverMcpConfig(paths);

    expect(config.found).toBe(true);
    expect(config.source).toBe('codex');
    expect(config.serverUrl).toBe('http://149.33.14.250');
    expect(JSON.stringify(config)).not.toContain('pb_');
  });

  it('discovers Codex MCP config with quoted TOML table keys', () => {
    const paths = tempPaths();
    const codexDir = join(paths.homePath, '.codex');
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(join(codexDir, 'config.toml'), [
      '[mcp_servers."project-brain"]',
      'bearer_token_env_var = "MCP_BEARER_TOKEN"',
      'url = "http://149.33.14.250/mcp"',
    ].join('\n'), 'utf-8');

    const config = discoverMcpConfig(paths);

    expect(config.found).toBe(true);
    expect(config.source).toBe('codex');
    expect(config.tokenEnv).toBe('MCP_BEARER_TOKEN');
  });

  it('imports a web handoff config without persisting raw bearer values', () => {
    const paths = tempPaths();
    const source = join(paths.homePath, 'mcp-monorepo-mcp-config.json');
    mkdirSync(paths.homePath, { recursive: true });
    writeFileSync(source, JSON.stringify({
      schema_version: 1,
      project_id: 'mcp-monorepo',
      endpoint: 'http://149.33.14.250/mcp/p/mcp-monorepo',
      local_path: 'C:\\Users\\New\\Desktop\\MCP',
      token_env: 'MCP_BEARER_TOKEN',
      mcpServers: {
        'project-brain': {
          url: 'http://149.33.14.250/mcp/p/mcp-monorepo',
          headers: { Authorization: `Bearer ${VALID_TEST_BEARER}` },
        },
      },
    }), 'utf-8');

    const result = importProjectConfig(paths, source);

    expect(result.profile).not.toBeNull();
    if (!result.profile) throw new Error('project profile missing');
    expect(result.profile.id).toBe('mcp-monorepo');
    expect(result.profile.serverUrl).toBe('http://149.33.14.250');
    expect(result.tokenDetected).toBe(true);
    expect(result.secretStaged).toBe(true);
    expect(readDesktopServiceSecret(result.profile)).toBe(VALID_TEST_BEARER);
    const secretState = readDesktopServiceSecretState(result.profile);
    expect(secretState.configured).toBe(true);
    expect(secretState.actualFingerprint).toMatch(new RegExp(`^sha256:[a-f0-9]{12}:len=${VALID_TEST_BEARER.length}$`));
    expect(secretState.actualFingerprint).not.toContain(VALID_TEST_BEARER);
    expect(secretState.acl.restricted).toBe(true);
    expect(JSON.stringify(readProfiles(paths))).not.toContain(VALID_TEST_BEARER);
  });

  it('does not stage placeholder bearer values from web handoff config', () => {
    const paths = tempPaths();
    const source = join(paths.homePath, 'mcp-placeholder-config.json');
    mkdirSync(paths.homePath, { recursive: true });
    writeFileSync(source, JSON.stringify({
      project_id: 'mcp-monorepo',
      endpoint: 'http://149.33.14.250/mcp/p/mcp-monorepo',
      local_path: join(paths.homePath, 'repo'),
      token_env: 'MCP_BEARER_TOKEN',
      mcpServers: {
        'project-brain': {
          url: 'http://149.33.14.250/mcp/p/mcp-monorepo',
          headers: { Authorization: `Bearer ${PLACEHOLDER_BEARER}` },
        },
      },
    }), 'utf-8');

    const result = importProjectConfig(paths, source);

    expect(result.profile).not.toBeNull();
    if (!result.profile) throw new Error('project profile missing');
    expect(result.tokenDetected).toBe(false);
    expect(result.secretStaged).toBe(false);
    expect(readDesktopServiceSecret(result.profile)).toBeNull();
  });

  it('imports a personal access config and applies its bearer after a project folder is saved', () => {
    const paths = tempPaths();
    const source = join(paths.homePath, 'mcp-access-config.json');
    const root = join(paths.homePath, 'Project Alpha');
    mkdirSync(paths.homePath, { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(source, JSON.stringify({
      schema_version: 1,
      kind: 'project-brain-access',
      server_url: 'http://149.33.14.250',
      token_env: 'MCP_BEARER_TOKEN',
      mcpServers: {
        'project-brain': {
          type: 'http',
          url: 'http://149.33.14.250/mcp',
          headers: { Authorization: `Bearer ${VALID_TEST_BEARER}` },
        },
      },
    }), 'utf-8');

    const imported = importProjectConfig(paths, source);
    const discovery = discoverMcpConfig(paths);
    const saved = saveProfile(paths, {
      id: 'project-alpha',
      name: 'Project Alpha',
      root,
      indexId: 'idx-project-alpha',
      serverUrl: '',
      tokenEnv: '',
    });
    const pack = buildDesktopConfigPackage(paths, 'project-alpha');

    expect(imported.profile).toBeNull();
    expect(imported.accessConfigImported).toBe(true);
    expect(imported.tokenDetected).toBe(true);
    expect(imported.secretStaged).toBe(false);
    expect(discovery.found).toBe(true);
    expect(discovery.serverUrl).toBe('http://149.33.14.250');
    expect(discovery.projectId).toBeNull();
    expect(readDesktopServiceSecret(saved)).toBe(VALID_TEST_BEARER);
    expect(saved.serverUrl).toBe('http://149.33.14.250');
    expect(saved.tokenEnv).toBe('MCP_BEARER_TOKEN');
    expect(pack.tokenAvailable).toBe(true);
    expect(pack.configJson).toContain(`Bearer ${VALID_TEST_BEARER}`);
    expect(pack.configJson).toContain('"url": "http://149.33.14.250/mcp/p/project-alpha"');
  });

  it('persists desktop UI state for section, theme and console preferences', () => {
    const paths = tempPaths();

    const saved = saveDesktopUiState(paths, {
      activeSection: 'prompt',
      theme: 'dark',
      consoleOpen: false,
      lastProjectId: 'demo',
      keyVisible: true,
    });

    expect(saved.activeSection).toBe('prompt');
    expect(readDesktopUiState(paths)).toEqual(saved);
  });

  it('builds a downloadable MCP config package with key and start prompt', () => {
    const paths = tempPaths();
    vi.stubEnv('MCP_BEARER_TOKEN', '');
    const source = join(paths.homePath, 'mcp-monorepo-mcp-config.json');
    mkdirSync(paths.homePath, { recursive: true });
    writeFileSync(source, JSON.stringify({
      project_id: 'mcp-monorepo',
      endpoint: 'http://149.33.14.250/mcp/p/mcp-monorepo',
      local_path: join(paths.homePath, 'repo'),
      token_env: 'MCP_BEARER_TOKEN',
      mcpServers: {
        'project-brain': {
          url: 'http://149.33.14.250/mcp/p/mcp-monorepo',
          headers: { Authorization: `Bearer ${VALID_TEST_BEARER}` },
        },
      },
    }), 'utf-8');
    mkdirSync(join(paths.homePath, 'repo'), { recursive: true });
    importProjectConfig(paths, source);

    const pack = buildDesktopConfigPackage(paths, 'mcp-monorepo');

    expect(pack.fileName).toBe('mcp-monorepo-mcp-config.json');
    expect(pack.tokenAvailable).toBe(true);
    expect(pack.tokenValue).toBe(VALID_TEST_BEARER);
    expect(pack.configJson).toContain(`Bearer ${VALID_TEST_BEARER}`);
    expect(pack.prompt).toContain('BRAIN ON — Brain MCP bootstrap');
    expect(pack.prompt).toContain(`Текущий local_path из MCP-файла: ${join(paths.homePath, 'repo')}`);
    expect(pack.prompt).toContain('brain_status(project_id="mcp-monorepo"');
    expect(pack.prompt).toContain('reinitialize_project_route');
    expect(pack.prompt).toContain('policy_context_pack');
    expect(pack.prompt).toContain('Лёгкая легенда MCP-режимов');
    expect(pack.prompt).toContain('wave / wavy / вейви');
    expect(pack.prompt).toContain('idol / идол');
    expect(pack.prompt).toContain('IDOL не внешняя шкала');
    expect(pack.prompt).not.toContain(VALID_TEST_BEARER);
  });

  it('builds a new project package from base server and stages project .brain files', () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'HyinahiTEst');
    mkdirSync(root, { recursive: true });
    vi.stubEnv('MCP_BEARER_TOKEN', VALID_ENV_BEARER);
    const saved = saveProfile(paths, {
      id: 'hyinahitest',
      name: 'HyinahiTEst',
      root,
      indexId: 'idx-hyinahitest',
      serverUrl: 'http://149.33.14.250/mcp/p/mcp-monorepo',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });

    const pack = buildDesktopConfigPackage(paths, 'hyinahitest', { bootstrap: true });
    const brainConfigPath = join(root, '.brain', 'config.json');
    const brainMcpPath = join(root, '.brain', 'mcp.json');

    expect(pack.fileName).toBe('hyinahitest-mcp-config.json');
    expect(pack.configJson).toContain('"url": "http://149.33.14.250/mcp/p/hyinahitest"');
    expect(pack.configJson).not.toContain('/mcp/p/mcp-monorepo');
    expect(pack.prompt).toContain('MCP endpoint: http://149.33.14.250/mcp/p/hyinahitest');
    expect(pack.prompt).toContain(`brain_status(project_id="hyinahitest", local_path="${root}")`);
    expect(existsSync(brainConfigPath)).toBe(true);
    expect(existsSync(brainMcpPath)).toBe(true);
    expect(pack.brainDir).toBe(join(root, '.brain'));
    expect(pack.brainConfigPath).toBe(brainConfigPath);
    expect(pack.brainMcpPath).toBe(brainMcpPath);

    const brainConfig = JSON.parse(readFileSync(brainConfigPath, 'utf-8')) as Record<string, unknown>;
    const brainMcp = JSON.parse(readFileSync(brainMcpPath, 'utf-8')) as {
      project_id?: string;
      endpoint?: string;
      mcpServers?: Record<string, { url?: string; headers?: Record<string, string> }>;
    };
    expect(brainConfig.project_id).toBe('hyinahitest');
    expect(brainConfig.server).toBe('http://149.33.14.250');
    expect(brainConfig.mcp_endpoint).toBe('http://149.33.14.250/mcp/p/hyinahitest');
    expect(brainConfig.mcp_config_path).toBe('.brain/mcp.json');
    expect(brainMcp.project_id).toBe('hyinahitest');
    expect(brainMcp.endpoint).toBe('http://149.33.14.250/mcp/p/hyinahitest');
    expect(brainMcp.mcpServers?.['project-brain']?.url).toBe('http://149.33.14.250/mcp/p/hyinahitest');
    expect(brainMcp.mcpServers?.['project-brain']?.headers?.Authorization).toBe(`Bearer ${VALID_ENV_BEARER}`);
    expect(readDesktopServiceSecret(saved)).toBe(VALID_ENV_BEARER);
  });

  it('promotes a bearer from project .brain mcp config into the local service secret', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'Client Project');
    mkdirSync(root, { recursive: true });
    vi.stubEnv('MCP_BEARER_TOKEN', '');
    const profile = saveProfile(paths, {
      id: 'client-project',
      name: 'Client Project',
      root,
      indexId: 'idx-client-project',
      serverUrl: 'http://149.33.14.250',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });
    const mcpPath = join(root, '.brain', 'mcp.json');
    mkdirSync(join(root, '.brain'), { recursive: true });
    writeFileSync(mcpPath, JSON.stringify({
      project_id: 'client-project',
      endpoint: 'http://149.33.14.250/mcp/p/client-project',
      mcpServers: {
        'project-brain': {
          url: 'http://149.33.14.250/mcp/p/client-project',
          headers: { Authorization: `Bearer ${VALID_TEST_BEARER}` },
        },
      },
    }), 'utf-8');
    vi.stubGlobal('fetch', verifiedMcpFetch());

    const check = await buildDesktopConnectionCheck(paths, 'client-project');

    expect(readDesktopServiceSecret(profile)).toBe(VALID_TEST_BEARER);
    expect(check.nodes.find(node => node.id === 'key')?.status).toBe('active');
    expect(check.nodes.find(node => node.id === 'server')?.status).toBe('active');
  });

  it('promotes a bearer from the saved project package when .brain mcp still has a placeholder', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'HyinahiTEst');
    mkdirSync(join(root, '.brain'), { recursive: true });
    vi.stubEnv('MCP_BEARER_TOKEN', '');
    const profile = saveProfile(paths, {
      id: 'hyinahitest',
      name: 'HyinahiTEst',
      root,
      indexId: 'idx-hyinahitest',
      serverUrl: 'http://149.33.14.250',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });
    writeFileSync(join(root, '.brain', 'mcp.json'), JSON.stringify({
      project_id: 'hyinahitest',
      endpoint: 'http://149.33.14.250/mcp/p/hyinahitest',
      mcpServers: {
        'project-brain': {
          url: 'http://149.33.14.250/mcp/p/hyinahitest',
          headers: { Authorization: 'Bearer ${MCP_BEARER_TOKEN}' },
        },
      },
    }), 'utf-8');
    writeFileSync(join(root, 'hyinahitest-mcp-config.json'), JSON.stringify({
      projectBrain: {
        projectId: 'hyinahitest',
        localPath: root,
        tokenEnv: 'MCP_BEARER_TOKEN',
      },
      mcpServers: {
        'project-brain': {
          url: 'http://149.33.14.250/mcp/p/hyinahitest',
          headers: { Authorization: `Bearer ${VALID_TEST_BEARER}` },
        },
      },
    }), 'utf-8');
    vi.stubGlobal('fetch', verifiedMcpFetch());

    const check = await buildDesktopConnectionCheck(paths, 'hyinahitest');
    const pack = buildDesktopConfigPackage(paths, 'hyinahitest', { bootstrap: true });
    const brainMcp = JSON.parse(readFileSync(join(root, '.brain', 'mcp.json'), 'utf-8')) as {
      readonly mcpServers?: Record<string, { readonly headers?: Record<string, string> }>;
    };

    expect(readDesktopServiceSecret(profile)).toBe(VALID_TEST_BEARER);
    expect(check.nodes.find(node => node.id === 'key')?.status).toBe('active');
    expect(check.nodes.find(node => node.id === 'server')?.status).toBe('active');
    expect(pack.tokenAvailable).toBe(true);
    expect(brainMcp.mcpServers?.['project-brain']?.headers?.Authorization).toBe(`Bearer ${VALID_TEST_BEARER}`);
  });

  it('builds the connection checklist from config, key, server and service state', async () => {
    const paths = tempPaths();
    const source = join(paths.homePath, 'checklist-project-mcp-config.json');
    mkdirSync(paths.homePath, { recursive: true });
    writeFileSync(source, JSON.stringify({
      project_id: 'checklist-project',
      endpoint: 'http://149.33.14.250/mcp/p/checklist-project',
      local_path: join(paths.homePath, 'repo'),
      token_env: 'MCP_BEARER_TOKEN',
      mcpServers: {
        'project-brain': {
          url: 'http://149.33.14.250/mcp/p/checklist-project',
          headers: { Authorization: `Bearer ${VALID_TEST_BEARER}` },
        },
      },
    }), 'utf-8');
    mkdirSync(join(paths.homePath, 'repo'), { recursive: true });
    importProjectConfig(paths, source);
    vi.stubGlobal('fetch', verifiedMcpFetch());

    const check = await buildDesktopConnectionCheck(paths, 'checklist-project');

    expect(check.nodes.map(node => node.id)).toEqual(['project', 'config', 'key', 'server', 'watcher']);
    expect(check.nodes.map(node => node.label)).toEqual(['Проект', 'Файл настройки', 'Ключ доступа', 'MCP-сервер', 'Watcher']);
    expect(check.nodes.find(node => node.id === 'server')?.status).toBe('active');
    expect(check.nodes.find(node => node.id === 'watcher')?.actionLabel).toBe('Установить службу');
    expect(check.overall).toBe('action_required');
  });

  it('offers service installation for a selected project that has config but no watcher service', async () => {
    const paths = tempPaths();
    const monorepoRoot = join(paths.homePath, 'MCP');
    const clientRoot = join(paths.homePath, 'HyinahiTEst');
    mkdirSync(join(monorepoRoot, '.brain'), { recursive: true });
    mkdirSync(clientRoot, { recursive: true });
    writeFileSync(join(monorepoRoot, '.brain', 'watcher-runtime.json'), JSON.stringify({
      owner: { project_id: 'mcp-monorepo', root: monorepoRoot, pid: process.pid },
      updated_at: Date.now(),
    }), 'utf-8');
    saveProfile(paths, {
      id: 'mcp-monorepo',
      name: 'MCP Monorepo',
      root: monorepoRoot,
      indexId: 'idx-mcp-monorepo',
      serverUrl: 'http://149.33.14.250',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });
    const clientProfile = saveProfile(paths, {
      id: 'isolated-client-project',
      name: 'Isolated Client Project',
      root: clientRoot,
      indexId: 'idx-isolated-client-project',
      serverUrl: 'http://149.33.14.250',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });
    stageDesktopServiceSecret(clientProfile, VALID_TEST_BEARER);
    vi.stubGlobal('fetch', verifiedMcpFetch());

    const check = await buildDesktopConnectionCheck(paths, 'isolated-client-project');
    const watcherNode = check.nodes.find(node => node.id === 'watcher');

    expect(check.service.projectId).toBe('isolated-client-project');
    expect(check.service.running).toBe(false);
    expect(watcherNode?.action).toBe('install_service');
    expect(watcherNode?.actionLabel).toBe('Установить службу');
  });

  it('lists MCP mode rails for the desktop readiness screen', () => {
    const paths = tempPaths();

    const modes = listDesktopModeSummaries(paths);

    expect(modes.map(mode => mode.id)).toEqual([
      'brain',
      'wave',
      'idol',
      'swarm',
      'watcher',
      'consultation',
      'active',
      'fix-loop',
      'deep-analysis',
      'review',
      'council',
      'audit',
      'refactor',
      'todoist-sync',
    ]);
    expect(modes.find(mode => mode.id === 'idol')?.rails.length).toBeGreaterThan(0);
    expect(modes.find(mode => mode.id === 'wave')?.description).toContain('три волны');
    expect(modes.find(mode => mode.id === 'wave')?.aliases).toEqual(expect.arrayContaining(['wavy', 'вейви']));
    expect(modes.find(mode => mode.id === 'idol')?.aliases).toEqual(expect.arrayContaining(['idol', 'идол']));
    expect(modes.find(mode => mode.id === 'idol')?.confusionGuard).toContain('не внешняя шкала');
    expect(modes.find(mode => mode.id === 'runtime-policy-gates')).toBeUndefined();
    expect(modes.find(mode => mode.id === 'todoist-sync')?.group).toBe('Интеграции');
  });

  it('opens a local desktop session only after valid credentials and config discovery', async () => {
    const paths = tempPaths();
    vi.stubEnv('MCP_BEARER_TOKEN', '');
    const codexDir = join(paths.homePath, '.codex');
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(join(codexDir, 'config.toml'), [
      '[mcp_servers.project-brain]',
      'bearer_token_env_var = "MCP_BEARER_TOKEN"',
      'url = "http://149.33.14.250/mcp"',
    ].join('\n'), 'utf-8');

    const state = await loginAccess(paths, { email: 'client@example.com', password: 'password123' });

    expect(state.signedIn).toBe(true);
    expect(state.serverVerified).toBe(false);
    expect(state.serviceSecretConfigured).toBe(false);
    expect(state.status).toBe('secret_missing');
    expect(state.gates.some(gate => gate.decision === 'prompt')).toBe(true);
  });

  it('stages a barrier key entered on login before server verification', async () => {
    const paths = tempPaths();
    const codexDir = join(paths.homePath, '.codex');
    const root = join(paths.homePath, 'Desktop', 'MCP');
    mkdirSync(codexDir, { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(join(codexDir, 'config.toml'), [
      '[mcp_servers.project-brain]',
      'bearer_token_env_var = "MCP_BEARER_TOKEN"',
      'url = "http://149.33.14.250/mcp/p/mcp-monorepo"',
    ].join('\n'), 'utf-8');
    const profile = defaultProfile(paths);
    if (!profile) throw new Error('default profile missing');
    const authorizations: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      authorizations.push(headers.get('authorization') ?? '');
      return verifiedMcpFetch()(_input, init);
    }));

    const state = await loginAccess(paths, {
      email: 'client@example.com',
      password: 'pb_login_secret',
    });

    expect(readDesktopServiceSecret(profile)).toBe('pb_login_secret');
    expect(authorizations[0]).toBe('Bearer pb_login_secret');
    expect(state.serverVerified).toBe(true);
    expect(state.status).toBe('local_ready');
  });

  it('prefers a valid environment bearer over a placeholder local service secret during login verification', async () => {
    const paths = tempPaths();
    const codexDir = join(paths.homePath, '.codex');
    const root = join(paths.homePath, 'Desktop', 'MCP');
    mkdirSync(codexDir, { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(join(codexDir, 'config.toml'), [
      '[mcp_servers.project-brain]',
      'bearer_token_env_var = "MCP_BEARER_TOKEN"',
      'url = "http://149.33.14.250/mcp/p/mcp-monorepo"',
    ].join('\n'), 'utf-8');
    const profile = defaultProfile(paths);
    if (!profile) throw new Error('default profile missing');
    stageDesktopServiceSecret(profile, PLACEHOLDER_BEARER);
    vi.stubEnv('MCP_BEARER_TOKEN', VALID_ENV_BEARER);
    const authorizations: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('authorization') ?? '';
      authorizations.push(authorization);
      if (authorization !== `Bearer ${VALID_ENV_BEARER}`) return new Response('denied', { status: 401 });
      return verifiedMcpFetch()(_input, init);
    }));

    const state = await loginAccess(paths, { email: 'client@example.com', password: 'password123' });

    expect(readDesktopServiceSecret(profile)).toBe(VALID_ENV_BEARER);
    expect(authorizations[0]).toBe(`Bearer ${VALID_ENV_BEARER}`);
    expect(state.serverVerified).toBe(true);
    expect(state.status).toBe('local_ready');
  });

  it('falls back to a valid environment bearer when the local service secret fails verification', async () => {
    const paths = tempPaths();
    const codexDir = join(paths.homePath, '.codex');
    const root = join(paths.homePath, 'Desktop', 'MCP');
    mkdirSync(codexDir, { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(join(codexDir, 'config.toml'), [
      '[mcp_servers.project-brain]',
      'bearer_token_env_var = "MCP_BEARER_TOKEN"',
      'url = "http://149.33.14.250/mcp/p/mcp-monorepo"',
    ].join('\n'), 'utf-8');
    const profile = defaultProfile(paths);
    if (!profile) throw new Error('default profile missing');
    stageDesktopServiceSecret(profile, STALE_LOCAL_BEARER);
    vi.stubEnv('MCP_BEARER_TOKEN', VALID_ENV_BEARER);
    const authorizations: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('authorization') ?? '';
      authorizations.push(authorization);
      if (authorization !== `Bearer ${VALID_ENV_BEARER}`) return new Response('denied', { status: 401 });
      return verifiedMcpFetch()(_input, init);
    }));

    const state = await loginAccess(paths, { email: 'client@example.com', password: 'password123' });

    expect(readDesktopServiceSecret(profile)).toBe(VALID_ENV_BEARER);
    expect(authorizations[0]).toBe(`Bearer ${STALE_LOCAL_BEARER}`);
    expect(authorizations[1]).toBe(`Bearer ${VALID_ENV_BEARER}`);
    expect(state.serverVerified).toBe(true);
    expect(state.status).toBe('local_ready');
  });

  it('lists the default Codex-backed project when no profile was imported yet', () => {
    const paths = tempPaths();
    const codexDir = join(paths.homePath, '.codex');
    const root = join(paths.homePath, 'Desktop', 'MCP');
    mkdirSync(codexDir, { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(join(codexDir, 'config.toml'), [
      '[mcp_servers.project-brain]',
      'bearer_token_env_var = "MCP_BEARER_TOKEN"',
      'url = "http://149.33.14.250/mcp/p/mcp-monorepo"',
    ].join('\n'), 'utf-8');

    const projects = listDesktopProjectProfiles(paths);

    expect(projects).toHaveLength(1);
    expect(projects[0]?.id).toBe('mcp-monorepo');
    expect(projects[0]?.serverUrl).toBe('http://149.33.14.250');
  });

  it('treats the default Codex-backed profile as a configured project in diagnostics', () => {
    const paths = tempPaths();
    const codexDir = join(paths.homePath, '.codex');
    const root = join(paths.homePath, 'Desktop', 'MCP');
    mkdirSync(codexDir, { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(join(codexDir, 'config.toml'), [
      '[mcp_servers.project-brain]',
      'bearer_token_env_var = "MCP_BEARER_TOKEN"',
      'url = "http://149.33.14.250/mcp/p/mcp-monorepo"',
    ].join('\n'), 'utf-8');

    const diagnostics = previewDiagnostics(paths);

    expect(diagnostics.findings).toContain('Профиль проекта найден');
    expect(diagnostics.findings).not.toContain('Профиль проекта не импортирован');
  });

  it('exports diagnostics with secret fingerprints but without raw bearer values', () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'repo');
    mkdirSync(root, { recursive: true });
    const profile = saveProfile(paths, {
      id: 'demo',
      name: 'Demo',
      root,
      indexId: 'idx-demo',
      serverUrl: 'https://brain.example',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });
    stageDesktopServiceSecret(profile, VALID_TEST_BEARER);

    const diagnostics = previewDiagnostics(paths);
    const serialized = JSON.stringify(diagnostics);

    expect(diagnostics.included.some(item => item.startsWith('Secret fingerprint: sha256:'))).toBe(true);
    expect(serialized).not.toContain(VALID_TEST_BEARER);
    expect(serialized).toContain('Bearer-токен');
  });

  it('keeps the desktop session signed in after the renderer refreshes access status', async () => {
    const paths = tempPaths();
    const source = join(paths.homePath, 'mcp-monorepo-mcp-config.json');
    mkdirSync(paths.homePath, { recursive: true });
    writeFileSync(source, JSON.stringify({
      project_id: 'mcp-monorepo',
      endpoint: 'http://149.33.14.250/mcp/p/mcp-monorepo',
      local_path: join(paths.homePath, 'repo'),
      token_env: 'MCP_BEARER_TOKEN',
      mcpServers: {
        'project-brain': {
          url: 'http://149.33.14.250/mcp/p/mcp-monorepo',
          headers: { Authorization: `Bearer ${VALID_TEST_BEARER}` },
        },
      },
    }), 'utf-8');
    mkdirSync(join(paths.homePath, 'repo'), { recursive: true });
    importProjectConfig(paths, source);
    vi.stubGlobal('fetch', verifiedMcpFetch());

    const loginState = await loginAccess(paths, { email: 'client@example.com', password: 'password123' });
    const refreshedState = readAccessState(paths);

    expect(loginState.signedIn).toBe(true);
    expect(refreshedState.signedIn).toBe(true);
    expect(refreshedState.email).toBe('client@example.com');
    expect(refreshedState.status).toBe('local_ready');
  });

  it('uses the Codex MCP endpoint for the default desktop profile server verification', async () => {
    const paths = tempPaths();
    const codexDir = join(paths.homePath, '.codex');
    const root = join(paths.homePath, 'Desktop', 'MCP');
    mkdirSync(codexDir, { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(join(codexDir, 'config.toml'), [
      '[mcp_servers.project-brain]',
      'bearer_token_env_var = "MCP_BEARER_TOKEN"',
      'url = "http://149.33.14.250/mcp/p/mcp-monorepo"',
    ].join('\n'), 'utf-8');
    const profile = defaultProfile(paths);
    if (!profile) throw new Error('default profile missing');
    stageDesktopServiceSecret(profile, VALID_TEST_BEARER);
    const requestedUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrls.push(String(input));
      return verifiedMcpFetch()(input, init);
    }));

    const state = await loginAccess(paths, { email: 'client@example.com', password: 'password123' });

    expect(state.signedIn).toBe(true);
    expect(requestedUrls[0]).toBe('http://149.33.14.250/mcp/p/mcp-monorepo');
    expect(state.serverVerified).toBe(true);
  });

  it('uses the Codex MCP endpoint in the default connection checklist', async () => {
    const paths = tempPaths();
    const codexDir = join(paths.homePath, '.codex');
    const root = join(paths.homePath, 'Desktop', 'MCP');
    mkdirSync(codexDir, { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(join(codexDir, 'config.toml'), [
      '[mcp_servers.project-brain]',
      'bearer_token_env_var = "MCP_BEARER_TOKEN"',
      'url = "http://149.33.14.250/mcp/p/mcp-monorepo"',
    ].join('\n'), 'utf-8');
    const profile = defaultProfile(paths);
    if (!profile) throw new Error('default profile missing');
    stageDesktopServiceSecret(profile, VALID_TEST_BEARER);
    const requestedUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrls.push(String(input));
      return verifiedMcpFetch()(input, init);
    }));

    const check = await buildDesktopConnectionCheck(paths, 'mcp-monorepo');

    expect(requestedUrls[0]).toBe('http://149.33.14.250/mcp/p/mcp-monorepo');
    expect(check.nodes.find(node => node.id === 'server')?.status).toBe('active');
  });

  it('uses the Codex MCP endpoint in the default downloadable config package', () => {
    const paths = tempPaths();
    const codexDir = join(paths.homePath, '.codex');
    const root = join(paths.homePath, 'Desktop', 'MCP');
    mkdirSync(codexDir, { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(join(codexDir, 'config.toml'), [
      '[mcp_servers.project-brain]',
      'bearer_token_env_var = "MCP_BEARER_TOKEN"',
      'url = "http://149.33.14.250/mcp/p/mcp-monorepo"',
    ].join('\n'), 'utf-8');

    const pack = buildDesktopConfigPackage(paths, 'mcp-monorepo');

    expect(pack.configJson).toContain('"url": "http://149.33.14.250/mcp/p/mcp-monorepo"');
    expect(pack.prompt).toContain('MCP endpoint: http://149.33.14.250/mcp/p/mcp-monorepo');
  });

  it('builds the downloadable config package from env bearer when the local service secret is a placeholder', () => {
    const paths = tempPaths();
    const codexDir = join(paths.homePath, '.codex');
    const root = join(paths.homePath, 'Desktop', 'MCP');
    mkdirSync(codexDir, { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(join(codexDir, 'config.toml'), [
      '[mcp_servers.project-brain]',
      'bearer_token_env_var = "MCP_BEARER_TOKEN"',
      'url = "http://149.33.14.250/mcp/p/mcp-monorepo"',
    ].join('\n'), 'utf-8');
    const profile = defaultProfile(paths);
    if (!profile) throw new Error('default profile missing');
    stageDesktopServiceSecret(profile, PLACEHOLDER_BEARER);
    vi.stubEnv('MCP_BEARER_TOKEN', VALID_ENV_BEARER);

    const pack = buildDesktopConfigPackage(paths, 'mcp-monorepo');

    expect(pack.tokenAvailable).toBe(true);
    expect(pack.tokenValue).toBe(VALID_ENV_BEARER);
    expect(pack.configJson).toContain(`Bearer ${VALID_ENV_BEARER}`);
    expect(pack.configJson).not.toContain(PLACEHOLDER_BEARER);
  });

  it('builds the downloadable config package from the local project secret even when an env bearer exists', () => {
    const paths = tempPaths();
    const codexDir = join(paths.homePath, '.codex');
    const root = join(paths.homePath, 'Desktop', 'MCP');
    mkdirSync(codexDir, { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(join(codexDir, 'config.toml'), [
      '[mcp_servers.project-brain]',
      'bearer_token_env_var = "MCP_BEARER_TOKEN"',
      'url = "http://149.33.14.250/mcp/p/mcp-monorepo"',
    ].join('\n'), 'utf-8');
    const profile = defaultProfile(paths);
    if (!profile) throw new Error('default profile missing');
    stageDesktopServiceSecret(profile, STALE_LOCAL_BEARER);
    vi.stubEnv('MCP_BEARER_TOKEN', VALID_ENV_BEARER);

    const pack = buildDesktopConfigPackage(paths, 'mcp-monorepo');

    expect(pack.tokenAvailable).toBe(true);
    expect(pack.tokenValue).toBe(STALE_LOCAL_BEARER);
    expect(pack.configJson).toContain(`Bearer ${STALE_LOCAL_BEARER}`);
    expect(pack.configJson).not.toContain(VALID_ENV_BEARER);
  });

  it('keeps the desktop session bearer_unverified after config import until the server verifies access', async () => {
    const paths = tempPaths();
    const source = join(paths.homePath, 'mcp-monorepo-mcp-config.json');
    mkdirSync(paths.homePath, { recursive: true });
    writeFileSync(source, JSON.stringify({
      project_id: 'mcp-monorepo',
      endpoint: 'http://149.33.14.250/mcp/p/mcp-monorepo',
      local_path: join(paths.homePath, 'repo'),
      token_env: 'MCP_BEARER_TOKEN',
      mcpServers: {
        'project-brain': {
          url: 'http://149.33.14.250/mcp/p/mcp-monorepo',
          headers: { Authorization: `Bearer ${VALID_TEST_BEARER}` },
        },
      },
    }), 'utf-8');
    mkdirSync(join(paths.homePath, 'repo'), { recursive: true });
    importProjectConfig(paths, source);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 401 })));

    const state = await loginAccess(paths, { email: 'client@example.com', password: 'password123' });

    expect(state.signedIn).toBe(true);
    expect(state.serviceSecretConfigured).toBe(true);
    expect(state.serverVerified).toBe(false);
    expect(state.status).toBe('bearer_unverified');
    expect(state.message).toContain('серверная проверка');
  });

  it('moves the desktop session to local_ready only after server verification and a staged service secret', async () => {
    const paths = tempPaths();
    const source = join(paths.homePath, 'mcp-monorepo-mcp-config.json');
    mkdirSync(paths.homePath, { recursive: true });
    writeFileSync(source, JSON.stringify({
      project_id: 'mcp-monorepo',
      endpoint: 'http://149.33.14.250/mcp/p/mcp-monorepo',
      local_path: join(paths.homePath, 'repo'),
      token_env: 'MCP_BEARER_TOKEN',
      mcpServers: {
        'project-brain': {
          url: 'http://149.33.14.250/mcp/p/mcp-monorepo',
          headers: { Authorization: `Bearer ${VALID_TEST_BEARER}` },
        },
      },
    }), 'utf-8');
    mkdirSync(join(paths.homePath, 'repo'), { recursive: true });
    importProjectConfig(paths, source);

    vi.stubGlobal('fetch', verifiedMcpFetch());

    const state = await loginAccess(paths, {
      email: 'client@example.com',
      password: 'password123',
    });

    expect(state.signedIn).toBe(true);
    expect(state.serviceSecretConfigured).toBe(true);
    expect(state.serverVerified).toBe(true);
    expect(state.status).toBe('local_ready');
    expect(state.message).toContain('secret-файл');
  });

  it('clears the desktop session on logout and returns the signed-out state', async () => {
    const paths = tempPaths();
    const codexDir = join(paths.homePath, '.codex');
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(join(codexDir, 'config.toml'), [
      '[mcp_servers.project-brain]',
      'bearer_token_env_var = "MCP_BEARER_TOKEN"',
      'url = "http://149.33.14.250/mcp"',
    ].join('\n'), 'utf-8');

    const loginState = await loginAccess(paths, { email: 'client@example.com', password: 'password123' });
    const logoutState = logoutAccess(paths);
    const refreshedState = readAccessState(paths);

    expect(loginState.signedIn).toBe(true);
    expect(logoutState.signedIn).toBe(false);
    expect(refreshedState.signedIn).toBe(false);
    expect(refreshedState.email).toBeNull();
  });

  it('blocks service mutation when the MCP server does not verify the bearer secret', async () => {
    const paths = tempPaths();
    const source = join(paths.homePath, 'mcp-monorepo-mcp-config.json');
    mkdirSync(paths.homePath, { recursive: true });
    writeFileSync(source, JSON.stringify({
      project_id: 'mcp-monorepo',
      endpoint: 'http://149.33.14.250/mcp/p/mcp-monorepo',
      local_path: join(paths.homePath, 'repo'),
      token_env: 'MCP_BEARER_TOKEN',
      mcpServers: {
        'project-brain': {
          url: 'http://149.33.14.250/mcp/p/mcp-monorepo',
          headers: { Authorization: `Bearer ${VALID_TEST_BEARER}` },
        },
      },
    }), 'utf-8');
    mkdirSync(join(paths.homePath, 'repo'), { recursive: true });
    const imported = importProjectConfig(paths, source);
    expect(imported.profile).not.toBeNull();
    if (!imported.profile) throw new Error('project profile missing');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 401 })));

    const result = await runServiceAction(paths, { action: 'start', projectId: imported.profile.id, confirmed: true });

    expect(result.executed).toBe(false);
    expect(result.policy.decision).toBe('deny');
    expect(result.output).toContain('Сервер MCP не подтвердил доступ');
  });

  it('checks release availability without requiring a project bearer or mutating the service', async () => {
    const paths = tempPaths();
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response(JSON.stringify({
        tag_name: 'v9.9.9',
        html_url: 'https://github.com/horggorg88-pixel/project-brain-watcher/releases/tag/v9.9.9',
      }), { status: 200 });
    }));

    const result = await runServiceAction(paths, { action: 'check_update', projectId: 'missing-project', confirmed: false });

    expect(result.executed).toBe(false);
    expect(result.policy.decision).toBe('allow');
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Новая версия доступна для скачивания.');
    expect(result.output).toContain('Release: https://github.com/horggorg88-pixel/project-brain-watcher/releases/tag/v9.9.9');
    expect(requests[0]).toContain('/releases/latest');
  });
});

function verifiedMcpFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const rawBody = typeof init?.body === 'string' ? init.body : '';
    if (rawBody.includes('"initialize"')) {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } }), {
        status: 200,
        headers: { 'mcp-session-id': 'desktop-session-1' },
      });
    }
    if (rawBody.includes('"tools/list"')) {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [] } }), { status: 200 });
    }
    return new Response('unexpected request', { status: 400 });
  });
}

function statusFixture(overrides: Partial<WatcherServiceStatus>): WatcherServiceStatus {
  return {
    health: 'stopped',
    installed: true,
    lastError: null,
    lastSyncAt: null,
    pid: null,
    projectId: 'demo',
    queueDepth: 0,
    readOnly: true,
    root: 'C:\\repo',
    running: false,
    logs: null,
    ...overrides,
  };
}

function tempPaths(): DesktopCorePaths {
  const root = mkdtempSync(join(tmpdir(), 'watcher-desktop-core-'));
  tempDirs.push(root);
  return {
    homePath: join(root, 'home'),
    userDataPath: join(root, 'user-data'),
  };
}
