import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enrollManagedDevice,
  readManagedDeviceStatus,
} from '../../apps/watcher-desktop/src/desktop-support-device.js';
import { runSupportAgentOnce } from '../../apps/watcher-desktop/src/desktop-support-agent.js';
import type { DesktopAccountAuthorization } from '../../apps/watcher-desktop/src/desktop-account-auth.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('watcher desktop support device', () => {
  it('enrolls a managed device without writing the account bearer into state JSON', async () => {
    const paths = tempPaths();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      device: {
        deviceId: 'dev_test',
        meshUrl: 'https://mesh.example.test/device/dev_test',
      },
      deviceToken: 'pbs_device_token',
    }), { status: 200 })));

    const result = await enrollManagedDevice(paths, account(), 'mcp-project');
    const status = readManagedDeviceStatus(paths);
    const statePath = join(paths.userDataPath, 'desktop-support-device.json');
    const state = existsSync(statePath) ? readFileSync(statePath, 'utf-8') : '';

    expect(result.enrolled).toBe(true);
    expect(status.deviceId).toBe('dev_test');
    expect(state).toContain('pbs_device_token');
    expect(state).not.toContain('pb_account_bearer');
  });

  it('claims and completes diagnostics jobs with the managed device token', async () => {
    const paths = tempPaths();
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requests.push(`${init?.method ?? 'GET'} ${urlOf(input)}`);
      if (urlOf(input).endsWith('/api/support/devices/enroll')) {
        return jsonResponse({ ok: true, device: { deviceId: 'dev_test', meshUrl: null }, deviceToken: 'pbs_device_token' });
      }
      if (urlOf(input).endsWith('/api/support/devices/heartbeat')) {
        return jsonResponse({ ok: true, device: { deviceId: 'dev_test' } });
      }
      if (urlOf(input).endsWith('/api/support/jobs/claim')) {
        return jsonResponse({
          ok: true,
          job: {
            jobId: 'job_test',
            action: 'collect_diagnostics',
            payload: { projectId: 'mcp-project' },
          },
        });
      }
      if (urlOf(input).endsWith('/api/support/jobs/job_test/complete')) {
        return jsonResponse({ ok: true, job: { jobId: 'job_test', status: 'succeeded' } });
      }
      return jsonResponse({ ok: false, error: 'unexpected request' }, 404);
    }));

    await enrollManagedDevice(paths, account(), 'mcp-project');
    const result = await runSupportAgentOnce(paths, 'mcp-project');

    expect(result.status).toBe('completed');
    expect(result.jobId).toBe('job_test');
    expect(requests).toEqual([
      'POST http://console.example.test/api/support/devices/enroll',
      'POST http://console.example.test/api/support/devices/heartbeat',
      'POST http://console.example.test/api/support/jobs/claim',
      'POST http://console.example.test/api/support/jobs/job_test/complete',
    ]);
  });
});

function tempPaths() {
  const root = mkdtempSync(join(tmpdir(), 'watcher-desktop-support-'));
  tempDirs.push(root);
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
    bearerToken: 'pb_account_bearer',
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
