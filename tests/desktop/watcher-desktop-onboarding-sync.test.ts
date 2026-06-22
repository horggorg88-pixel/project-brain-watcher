import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncDesktopOnboardingProgress } from '../../apps/watcher-desktop/src/desktop-onboarding-sync.js';
import { saveProfile, type DesktopCorePaths } from '../../apps/watcher-desktop/src/desktop-profile-store.js';
import { stageDesktopServiceSecret } from '../../apps/watcher-desktop/src/desktop-service-secret.js';

const tempDirs: string[] = [];
const PROJECT_ID = 'demo-project';
const VALID_TEST_BEARER = 'valid_test_bearer_12345678901234567890';

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('desktop onboarding sync', () => {
  it('reports project binding before Codex gate evidence', async () => {
    const paths = tempPaths();
    const projectRoot = join(paths.homePath, 'Desktop', 'Demo Project');
    mkdirSync(projectRoot, { recursive: true });
    writeCodexConfig(paths, projectRoot);
    const profile = saveProfile(paths, {
      id: PROJECT_ID,
      name: 'Demo Project',
      root: projectRoot,
      indexId: `idx-${PROJECT_ID}`,
      serverUrl: 'http://149.33.14.250',
      consoleUrl: 'http://console.example.test',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });
    stageDesktopServiceSecret(profile, VALID_TEST_BEARER);
    writeReadyCodexEvidence(projectRoot);
    const reportedEvents: Array<{ readonly eventType: string; readonly projectId?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      if (url.endsWith('/api/onboarding/events')) {
        reportedEvents.push(JSON.parse(String(init?.body ?? '{}')) as { readonly eventType: string; readonly projectId?: string });
        return jsonResponse({ ok: true });
      }
      return verifiedMcpResponse(init);
    }));

    const result = await syncDesktopOnboardingProgress(paths, PROJECT_ID);

    expect(result.check.projectId).toBe(PROJECT_ID);
    expect(result.check.codexGates.ready).toBe(true);
    expect(reportedEvents.map(event => event.eventType)).toEqual([
      'desktop_opened',
      'project_selected',
      'config_ready',
      'codex_gates_verified',
    ]);
    expect(reportedEvents.every(event => event.projectId === PROJECT_ID)).toBe(true);
  });
});

function tempPaths(): DesktopCorePaths {
  const root = mkdtempSync(join(tmpdir(), 'watcher-desktop-onboarding-sync-'));
  tempDirs.push(root);
  mkdirSync(join(root, 'home'), { recursive: true });
  mkdirSync(join(root, 'user-data'), { recursive: true });
  return {
    homePath: join(root, 'home'),
    userDataPath: join(root, 'user-data'),
  };
}

function writeCodexConfig(paths: DesktopCorePaths, projectRoot: string): void {
  const codexDir = join(paths.homePath, '.codex');
  mkdirSync(codexDir, { recursive: true });
  writeFileSync(join(codexDir, 'config.toml'), [
    '[mcp_servers.project-brain]',
    'bearer_token_env_var = "MCP_BEARER_TOKEN"',
    `url = "http://149.33.14.250/mcp/p/${PROJECT_ID}"`,
    `[projects."${projectRoot.replace(/\\/g, '\\\\')}"]`,
    'trust_level = "trusted"',
  ].join('\n'), 'utf-8');
}

function writeReadyCodexEvidence(projectRoot: string): void {
  const checkedAt = new Date().toISOString();
  const serviceDir = join(projectRoot, '.brain', 'service');
  mkdirSync(serviceDir, { recursive: true });
  writeFileSync(join(serviceDir, 'quality-gate-runs.json'), JSON.stringify({
    schemaVersion: 1,
    projectId: PROJECT_ID,
    projectRoot,
    checkedAt,
    commandRuns: {
      codexHooks: evidence('codex plugin add persistent-verifier', checkedAt),
    },
    verification: {
      codexTrust: evidence('read ~/.codex/config.toml projects trust', checkedAt),
      codexRuntime: evidence('codex --version', checkedAt),
      hookPersistence: evidence('Codex SessionStart', checkedAt),
      runtimeContext: evidence('Project Brain runtime context', checkedAt),
      smoke: evidence('npm test', checkedAt),
      rollback: evidence('codex plugin remove persistent-verifier', checkedAt),
    },
  }, null, 2), 'utf-8');
}

function evidence(command: string, checkedAt: string) {
  return {
    available: true,
    passed: true,
    detail: 'ok',
    checkedAt,
    staleAfterMs: 600_000,
    source: 'test',
    command,
    exitCode: 0,
  };
}

function verifiedMcpResponse(init?: RequestInit): Response {
  const rawBody = typeof init?.body === 'string' ? init.body : '';
  if (rawBody.includes('"initialize"')) {
    return jsonResponse(
      { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } },
      { 'mcp-session-id': 'desktop-session-1' },
    );
  }
  if (rawBody.includes('"tools/list"')) {
    return jsonResponse({ jsonrpc: '2.0', id: 2, result: { tools: [] } });
  }
  return new Response('unexpected request', { status: 400 });
}

function jsonResponse(body: Record<string, unknown>, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}
