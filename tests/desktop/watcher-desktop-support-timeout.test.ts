import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopAccountAuthorization } from '../../apps/watcher-desktop/src/desktop-account-auth.js';
import type {
  SupportAgentRunResult,
} from '../../apps/watcher-desktop/src/desktop-support-agent.js';
import { enrollManagedDevice } from '../../apps/watcher-desktop/src/desktop-support-device.js';

vi.mock('../../apps/watcher-desktop/src/desktop-codex-gates.js', () => ({
  verifyDesktopCodexGates: () => new Promise<Record<string, unknown>>(() => undefined),
}));

const tempDirs: string[] = [];
const ACCOUNT_BEARER = 'pb_account_bearer_12345678901234567890';
const previousTimeout = process.env.PROJECT_BRAIN_SUPPORT_JOB_TIMEOUT_MS;
const previousHttpTimeout = process.env.PROJECT_BRAIN_SUPPORT_HTTP_TIMEOUT_MS;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  if (previousTimeout === undefined) delete process.env.PROJECT_BRAIN_SUPPORT_JOB_TIMEOUT_MS;
  else process.env.PROJECT_BRAIN_SUPPORT_JOB_TIMEOUT_MS = previousTimeout;
  if (previousHttpTimeout === undefined) delete process.env.PROJECT_BRAIN_SUPPORT_HTTP_TIMEOUT_MS;
  else process.env.PROJECT_BRAIN_SUPPORT_HTTP_TIMEOUT_MS = previousHttpTimeout;
});

describe('watcher desktop support job timeout', () => {
  it('fails and completes a claimed support job when the local action hangs', async () => {
    process.env.PROJECT_BRAIN_SUPPORT_JOB_TIMEOUT_MS = '25';
    const paths = tempPaths();
    const completions: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (urlOf(input).endsWith('/api/support/devices/enroll')) {
        return jsonResponse({ ok: true, device: { deviceId: 'dev_timeout', meshUrl: null }, deviceToken: 'pbs_device_token' });
      }
      if (urlOf(input).endsWith('/api/support/devices/heartbeat')) {
        return jsonResponse({ ok: true, device: { deviceId: 'dev_timeout' } });
      }
      if (urlOf(input).endsWith('/api/support/jobs/claim')) {
        return jsonResponse({
          ok: true,
          job: {
            jobId: 'job_timeout',
            action: 'verify_codex_gates',
            payload: { projectId: 'mcp-project' },
          },
        });
      }
      if (urlOf(input).endsWith('/api/support/jobs/job_timeout/progress')) {
        return jsonResponse({ ok: true, job: { jobId: 'job_timeout', status: 'running' } });
      }
      if (urlOf(input).endsWith('/api/support/jobs/job_timeout/complete')) {
        completions.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return jsonResponse({ ok: true, job: { jobId: 'job_timeout', status: 'failed' } });
      }
      return jsonResponse({ ok: false, error: 'unexpected request' }, 404);
    }));

    await enrollManagedDevice(paths, account(), 'mcp-project');
    const { runSupportAgentOnce } = await import('../../apps/watcher-desktop/src/desktop-support-agent.js');
    const result = await Promise.race<SupportAgentRunResult | { readonly status: 'timed_out' }>([
      runSupportAgentOnce(paths, 'mcp-project'),
      delay(250).then(() => ({ status: 'timed_out' as const })),
    ]);

    expect(result.status).toBe('failed');
    expect(completions).toHaveLength(1);
    expect(JSON.stringify(completions[0])).toContain('timed out');
  });

  it('unblocks the support loop when a heartbeat request hangs', async () => {
    process.env.PROJECT_BRAIN_SUPPORT_HTTP_TIMEOUT_MS = '25';
    const paths = tempPaths();
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (urlOf(input).endsWith('/api/support/devices/enroll')) {
        return jsonResponse({ ok: true, device: { deviceId: 'dev_http_timeout', meshUrl: null }, deviceToken: 'pbs_device_token' });
      }
      if (urlOf(input).endsWith('/api/support/devices/heartbeat')) {
        return abortableNever(init?.signal);
      }
      return jsonResponse({ ok: false, error: 'unexpected request' }, 404);
    }));

    await enrollManagedDevice(paths, account(), 'mcp-project');
    const { runSupportAgentOnce } = await import('../../apps/watcher-desktop/src/desktop-support-agent.js');
    const result = await Promise.race<{ readonly message: string }>([
      runSupportAgentOnce(paths, 'mcp-project').then(
        () => ({ message: 'resolved' }),
        (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
      ),
      delay(250).then(() => ({ message: 'timed_out' })),
    ]);

    expect(result.message).toContain('/api/support/devices/heartbeat timed out');
  });
});

function tempPaths() {
  const root = mkdtempSync(join(tmpdir(), 'watcher-desktop-support-timeout-'));
  tempDirs.push(root);
  mkdirSync(join(root, 'home'), { recursive: true });
  mkdirSync(join(root, 'user-data'), { recursive: true });
  return {
    homePath: join(root, 'home'),
    userDataPath: join(root, 'user-data'),
  };
}

function account(): DesktopAccountAuthorization {
  return {
    ok: true,
    serverUrl: 'http://149.33.14.250',
    consoleUrl: 'http://console.example.test',
    supportBaseUrl: 'http://console.example.test',
    meshBaseUrl: 'https://mesh.example.test',
    bearerToken: ACCOUNT_BEARER,
    tokenEnv: 'MCP_BEARER_TOKEN',
    message: 'ok',
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function abortableNever(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const abort = () => {
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}
