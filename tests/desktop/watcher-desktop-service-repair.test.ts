import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SavedProjectProfile, WatcherServiceStatus } from '../../apps/watcher-desktop/src/contracts.js';
import {
  normalizeServiceInstallResult,
  readServiceLauncherRepairState,
  serviceInstallAlreadyExists,
  shouldRepairServiceLauncherBeforeAction,
} from '../../apps/watcher-desktop/src/desktop-service-repair.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('watcher desktop service repair', () => {
  it('recognizes existing Windows services as a repairable install result', () => {
    expect(serviceInstallAlreadyExists('A service with ID ProjectBrainWatcher-demo already exists.')).toBe(true);
    expect(serviceInstallAlreadyExists('FATAL - Failed to install the service. Указанная служба уже существует.')).toBe(true);
    expect(serviceInstallAlreadyExists('WinSW install failed with exit code 1')).toBe(false);
  });

  it('treats already-installed service install as repaired metadata instead of a hard failure', () => {
    const result = normalizeServiceInstallResult(1, [
      'Service launcher создан: .brain/service/launch-watcher.ps1',
      'A service with ID ProjectBrainWatcher-demo already exists.',
    ].join('\n'));

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('служба уже установлена');
    expect(result.output).toContain('launcher/XML обновлены');
  });

  it('detects missing and legacy service launchers that still use the LocalSystem npm cache', () => {
    const profile = profileFixture();
    const serviceDir = join(profile.root, '.brain', 'service');
    mkdirSync(serviceDir, { recursive: true });

    const missing = readServiceLauncherRepairState(profile);
    writeFileSync(join(serviceDir, 'launch-watcher.ps1'), '$ErrorActionPreference = "Stop"\n& npx @args\n', 'utf-8');
    const legacy = readServiceLauncherRepairState(profile);
    writeFileSync(join(serviceDir, 'launch-watcher.ps1'), [
      '$ErrorActionPreference = "Stop"',
      '$npmCache = Join-Path $PSScriptRoot "npm-cache"',
      '[Environment]::SetEnvironmentVariable("NPM_CONFIG_CACHE", $npmCache, "Process")',
      '[Environment]::SetEnvironmentVariable("NO_UPDATE_NOTIFIER", "1", "Process")',
    ].join('\n'), 'utf-8');
    const current = readServiceLauncherRepairState(profile);

    expect(missing.requiresRepair).toBe(true);
    expect(missing.reasons).toContain('launcher_missing');
    expect(legacy.requiresRepair).toBe(true);
    expect(legacy.reasons).toContain('launcher_missing_service_npm_cache');
    expect(current.requiresRepair).toBe(false);
  });

  it('requests launcher repair before starting an installed service with stale metadata', () => {
    const stale = { requiresRepair: true, reasons: ['launcher_missing_service_npm_cache'] };
    const current = { requiresRepair: false, reasons: [] };

    expect(shouldRepairServiceLauncherBeforeAction('start', statusFixture({ installed: true }), stale)).toBe(true);
    expect(shouldRepairServiceLauncherBeforeAction('restart', statusFixture({ installed: true }), stale)).toBe(true);
    expect(shouldRepairServiceLauncherBeforeAction('install', statusFixture({ installed: true }), stale)).toBe(true);
    expect(shouldRepairServiceLauncherBeforeAction('stop', statusFixture({ installed: true }), stale)).toBe(false);
    expect(shouldRepairServiceLauncherBeforeAction('start', statusFixture({ installed: false }), stale)).toBe(false);
    expect(shouldRepairServiceLauncherBeforeAction('start', statusFixture({ installed: true }), current)).toBe(false);
  });
});

function profileFixture(): SavedProjectProfile {
  const root = mkdtempSync(join(tmpdir(), 'watcher-service-repair-'));
  tempDirs.push(root);
  return {
    id: 'demo',
    name: 'Demo',
    root,
    indexId: 'idx-demo',
    serverUrl: 'https://brain.example',
    tokenEnv: 'MCP_BEARER_TOKEN',
    createdAt: new Date(0).toISOString(),
  };
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
