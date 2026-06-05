import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loginAccess } from '../../apps/watcher-desktop/src/desktop-access.js';
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
  type DesktopCorePaths,
} from '../../apps/watcher-desktop/src/desktop-core.js';
import { readDesktopServiceSecret, readDesktopServiceSecretState } from '../../apps/watcher-desktop/src/desktop-service-secret.js';
import { parseWindowsServiceOutput } from '../../apps/watcher-desktop/src/desktop-service-status.js';
import { readDesktopUiState, saveDesktopUiState } from '../../apps/watcher-desktop/src/desktop-ui-state.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('watcher desktop core', () => {
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
          headers: { Authorization: 'Bearer pb_secret_value' },
        },
      },
    }), 'utf-8');

    const result = importProjectConfig(paths, source);

    expect(result.profile.id).toBe('mcp-monorepo');
    expect(result.profile.serverUrl).toBe('http://149.33.14.250');
    expect(result.tokenDetected).toBe(true);
    expect(result.secretStaged).toBe(true);
    expect(readDesktopServiceSecret(result.profile)).toBe('pb_secret_value');
    const secretState = readDesktopServiceSecretState(result.profile);
    expect(secretState.configured).toBe(true);
    expect(secretState.actualFingerprint).toMatch(/^sha256:[a-f0-9]{12}:len=15$/);
    expect(secretState.actualFingerprint).not.toContain('pb_secret_value');
    expect(secretState.acl.restricted).toBe(true);
    expect(JSON.stringify(readProfiles(paths))).not.toContain('pb_secret_value');
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
          headers: { Authorization: 'Bearer ${MCP_BEARER_TOKEN}' },
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
          headers: { Authorization: 'Bearer pb_secret_value' },
        },
      },
    }), 'utf-8');
    mkdirSync(join(paths.homePath, 'repo'), { recursive: true });
    importProjectConfig(paths, source);

    const pack = buildDesktopConfigPackage(paths, 'mcp-monorepo');

    expect(pack.fileName).toBe('mcp-monorepo-mcp-config.json');
    expect(pack.tokenAvailable).toBe(true);
    expect(pack.tokenValue).toBe('pb_secret_value');
    expect(pack.configJson).toContain('Bearer pb_secret_value');
    expect(pack.prompt).toContain('Работай только через MCP Project Brain');
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
          headers: { Authorization: 'Bearer pb_secret_value' },
        },
      },
    }), 'utf-8');
    mkdirSync(join(paths.homePath, 'repo'), { recursive: true });
    importProjectConfig(paths, source);
    vi.stubGlobal('fetch', verifiedMcpFetch());

    const check = await buildDesktopConnectionCheck(paths, 'mcp-monorepo');

    expect(check.nodes.map(node => node.id)).toEqual(['project', 'config', 'key', 'server', 'watcher']);
    expect(check.nodes.find(node => node.id === 'server')?.status).toBe('active');
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
          headers: { Authorization: 'Bearer pb_secret_value' },
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
          headers: { Authorization: 'Bearer pb_secret_value' },
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
          headers: { Authorization: 'Bearer pb_secret_value' },
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

function tempPaths(): DesktopCorePaths {
  const root = mkdtempSync(join(tmpdir(), 'watcher-desktop-core-'));
  tempDirs.push(root);
  return {
    homePath: join(root, 'home'),
    userDataPath: join(root, 'user-data'),
  };
}
