import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import { isServiceActionSettled, prepareServiceSecretForLaunch } from '../../apps/watcher-desktop/src/desktop-service-runner.js';
import { parseWindowsServiceOutput } from '../../apps/watcher-desktop/src/desktop-service-status.js';
import { readDesktopUiState, saveDesktopUiState } from '../../apps/watcher-desktop/src/desktop-ui-state.js';
import { defaultProfile } from '../../apps/watcher-desktop/src/desktop-profile-store.js';
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

  it('does not treat pending Windows service transitions as settled', () => {
    expect(isServiceActionSettled('stop', statusFixture({ running: false, lastError: 'Windows Service STOP_PENDING' }))).toBe(false);
    expect(isServiceActionSettled('start', statusFixture({ running: false, lastError: 'Windows Service START_PENDING' }))).toBe(false);
    expect(isServiceActionSettled('restart', statusFixture({ running: false, lastError: 'Windows Service STOP_PENDING' }))).toBe(false);
    expect(isServiceActionSettled('stop', statusFixture({ running: false, lastError: 'Windows Service STOPPED' }))).toBe(true);
    expect(isServiceActionSettled('start', statusFixture({ running: true, health: 'healthy', lastError: null }))).toBe(true);
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
    expect(config.serverUrl).toBe('http://149.33.14.250/mcp');
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

    expect(result.tokenDetected).toBe(false);
    expect(result.secretStaged).toBe(false);
    expect(readDesktopServiceSecret(result.profile)).toBeNull();
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
    expect(pack.prompt).not.toContain(VALID_TEST_BEARER);
  });

  it('builds the connection checklist from config, key, server and service state', async () => {
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

    const check = await buildDesktopConnectionCheck(paths, 'mcp-monorepo');

    expect(check.nodes.map(node => node.id)).toEqual(['project', 'config', 'key', 'server', 'watcher']);
    expect(check.nodes.map(node => node.label)).toEqual(['Проект', 'Файл настройки', 'Ключ доступа', 'MCP-сервер', 'Watcher']);
    expect(check.nodes.find(node => node.id === 'server')?.status).toBe('active');
    expect(check.nodes.find(node => node.id === 'watcher')?.actionLabel).toBe('Запустить watcher');
    expect(check.overall).toBe('action_required');
  });

  it('lists MCP mode rails for the desktop readiness screen', () => {
    const paths = tempPaths();

    const modes = listDesktopModeSummaries(paths);

    expect(modes.map(mode => mode.id)).toEqual(['brain', 'wave', 'idol', 'swarm', 'watcher']);
    expect(modes.find(mode => mode.id === 'idol')?.rails.length).toBeGreaterThan(0);
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

  it('prefers a valid environment bearer over a stale local service secret during login verification', async () => {
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
    expect(authorizations[0]).toBe(`Bearer ${VALID_ENV_BEARER}`);
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
    expect(projects[0]?.serverUrl).toBe('http://149.33.14.250/mcp/p/mcp-monorepo');
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

  it('builds the downloadable config package from env bearer when the local service secret is stale', () => {
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
    expect(pack.tokenValue).toBe(VALID_ENV_BEARER);
    expect(pack.configJson).toContain(`Bearer ${VALID_ENV_BEARER}`);
    expect(pack.configJson).not.toContain(STALE_LOCAL_BEARER);
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
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 401 })));

    const result = await runServiceAction(paths, { action: 'start', projectId: imported.profile.id, confirmed: true });

    expect(result.executed).toBe(false);
    expect(result.policy.decision).toBe('deny');
    expect(result.output).toContain('Сервер MCP не подтвердил доступ');
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
