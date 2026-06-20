import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SavedProjectProfile, WatcherServiceStatus } from '../../apps/watcher-desktop/src/contracts.js';
import {
  buildServiceImagePathRepairArgs,
  normalizeServiceInstallResult,
  normalizeServiceRefreshResult,
  readServiceLauncherRepairState,
  serviceInstallAlreadyExists,
  serviceImagePathRepairRequired,
  serviceRefreshUnsupported,
  shouldRepairServiceLauncherBeforeAction,
} from '../../apps/watcher-desktop/src/desktop-service-repair.js';
import { spawnWatcher } from '../../apps/watcher-desktop/src/desktop-service-runner.js';
import { serviceCommandStatusLine } from '../../apps/watcher-desktop/src/renderer-service-command-status.js';

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

  it('treats unsupported WinSW refresh as a legacy wrapper compatibility fallback', () => {
    const output = [
      'FATAL - Unhandled exception',
      'System.Exception: Unknown command: refresh',
      '   at WinSW.Program.Run(String[] argsArray, IServiceConfig config)',
    ].join('\n');
    const result = normalizeServiceRefreshResult(1, output);

    expect(serviceRefreshUnsupported(output)).toBe(true);
    expect(serviceRefreshUnsupported('WinSW refresh failed with exit code 1')).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('WinSW refresh недоступен');
    expect(result.output).toContain('старый WinSW');
  });

  it('builds a Windows SCM binPath repair command for a stale installed service executable path', () => {
    const profile = profileFixture();

    expect(buildServiceImagePathRepairArgs(profile)).toEqual([
      'config',
      'ProjectBrainWatcher-demo',
      'binPath=',
      `"${join(profile.root, '.brain', 'service', 'ProjectBrainWatcher-demo.exe')}"`,
    ]);
  });

  it('requires SCM binPath repair only when service metadata points at another root', () => {
    expect(serviceImagePathRepairRequired(statusFixture({
      lastError: [
        'Windows Service STOPPED, WIN32_EXIT_CODE=1067',
        'Windows Service metadata указывает на другой root: C:\\Users\\New\\Desktop\\MCP. Ожидался C:\\Users\\New\\Desktop\\mcp-monorepo.',
      ].join('\n'),
    }))).toBe(true);
    expect(serviceImagePathRepairRequired(statusFixture({
      lastError: 'Windows Service STOPPED, WIN32_EXIT_CODE=1067',
    }))).toBe(false);
  });

  it('detects missing and legacy service launchers that still use the LocalSystem npm cache', () => {
    const profile = profileFixture();
    const serviceDir = join(profile.root, '.brain', 'service');
    mkdirSync(serviceDir, { recursive: true });

    const missing = readServiceLauncherRepairState(profile);
    writeFileSync(join(serviceDir, 'launch-watcher.ps1'), '$ErrorActionPreference = "Stop"\n& npx @args\n', 'utf-8');
    const legacy = readServiceLauncherRepairState(profile);
    const watcherEntry = join(serviceDir, 'runtime-entry.cjs');
    mkdirSync(serviceDir, { recursive: true });
    writeFileSync(watcherEntry, '#!/usr/bin/env node\n', 'utf-8');
    writeFileSync(join(serviceDir, 'active-runtime.json'), JSON.stringify({ entry: watcherEntry }), 'utf-8');
    writeFileSync(join(serviceDir, 'launch-watcher.ps1'), [
      '$ErrorActionPreference = "Stop"',
      '$npmCache = Join-Path $PSScriptRoot "npm-cache"',
      '[Environment]::SetEnvironmentVariable("NPM_CONFIG_CACHE", $npmCache, "Process")',
      '[Environment]::SetEnvironmentVariable("NO_UPDATE_NOTIFIER", "1", "Process")',
      '$exe = "node.exe"',
      `$argsList = @("${watcherEntry}", "start")`,
    ].join('\n'), 'utf-8');
    const current = readServiceLauncherRepairState(profile);

    expect(missing.requiresRepair).toBe(true);
    expect(missing.reasons).toContain('launcher_missing');
    expect(legacy.requiresRepair).toBe(true);
    expect(legacy.reasons).toContain('launcher_missing_service_npm_cache');
    expect(current.requiresRepair).toBe(false);
  });

  it('detects npx launchers even when npm cache guards are already present', () => {
    const profile = profileFixture();
    const serviceDir = join(profile.root, '.brain', 'service');
    mkdirSync(serviceDir, { recursive: true });
    writeFileSync(join(serviceDir, 'launch-watcher.ps1'), [
      '$ErrorActionPreference = "Stop"',
      '$npmCache = Join-Path $PSScriptRoot "npm-cache"',
      '[Environment]::SetEnvironmentVariable("NPM_CONFIG_CACHE", $npmCache, "Process")',
      '[Environment]::SetEnvironmentVariable("NO_UPDATE_NOTIFIER", "1", "Process")',
      '$exe = "npx.cmd"',
      '$argsList = @("--yes", "github:horggorg88-pixel/project-brain-watcher#v1.4.25", "start")',
    ].join('\n'), 'utf-8');

    const state = readServiceLauncherRepairState(profile);

    expect(state.requiresRepair).toBe(true);
    expect(state.reasons).toContain('launcher_uses_npx_runner');
  });

  it('requires repair when a node launcher points at a missing local service runtime', () => {
    const profile = profileFixture();
    const serviceDir = join(profile.root, '.brain', 'service');
    const watcherEntry = join(serviceDir, 'runtime-entry.cjs');
    mkdirSync(serviceDir, { recursive: true });
    writeFileSync(join(serviceDir, 'launch-watcher.ps1'), [
      '$ErrorActionPreference = "Stop"',
      '$npmCache = Join-Path $PSScriptRoot "npm-cache"',
      '[Environment]::SetEnvironmentVariable("NPM_CONFIG_CACHE", $npmCache, "Process")',
      '[Environment]::SetEnvironmentVariable("NO_UPDATE_NOTIFIER", "1", "Process")',
      '$exe = "node.exe"',
      `$argsList = @("${watcherEntry}", "start")`,
    ].join('\n'), 'utf-8');

    const state = readServiceLauncherRepairState(profile);

    expect(state.requiresRepair).toBe(true);
    expect(state.reasons).toContain('service_runtime_missing');
  });

  it('requires repair when the local service runtime manifest is missing', () => {
    const profile = profileFixture();
    const serviceDir = join(profile.root, '.brain', 'service');
    const watcherEntry = join(serviceDir, 'runtime-entry.cjs');
    mkdirSync(serviceDir, { recursive: true });
    writeFileSync(watcherEntry, '#!/usr/bin/env node\n', 'utf-8');
    writeFileSync(join(serviceDir, 'launch-watcher.ps1'), [
      '$ErrorActionPreference = "Stop"',
      '$npmCache = Join-Path $PSScriptRoot "npm-cache"',
      '[Environment]::SetEnvironmentVariable("NPM_CONFIG_CACHE", $npmCache, "Process")',
      '[Environment]::SetEnvironmentVariable("NO_UPDATE_NOTIFIER", "1", "Process")',
      '$exe = "node.exe"',
      `$argsList = @("${watcherEntry}", "start")`,
    ].join('\n'), 'utf-8');

    const state = readServiceLauncherRepairState(profile);

    expect(state.requiresRepair).toBe(true);
    expect(state.reasons).toContain('service_runtime_manifest_missing');
  });

  it('requires repair when service XML still launches npx metadata', () => {
    const profile = profileFixture();
    const serviceDir = join(profile.root, '.brain', 'service');
    const watcherEntry = join(serviceDir, 'runtime-entry.cjs');
    mkdirSync(serviceDir, { recursive: true });
    writeFileSync(watcherEntry, '#!/usr/bin/env node\n', 'utf-8');
    writeFileSync(join(serviceDir, 'active-runtime.json'), JSON.stringify({ entry: watcherEntry }), 'utf-8');
    writeFileSync(join(serviceDir, 'launch-watcher.ps1'), [
      '$ErrorActionPreference = "Stop"',
      '$npmCache = Join-Path $PSScriptRoot "npm-cache"',
      '[Environment]::SetEnvironmentVariable("NPM_CONFIG_CACHE", $npmCache, "Process")',
      '[Environment]::SetEnvironmentVariable("NO_UPDATE_NOTIFIER", "1", "Process")',
      '$exe = "node.exe"',
      `$argsList = @("${watcherEntry}", "start")`,
    ].join('\n'), 'utf-8');
    writeFileSync(join(serviceDir, 'ProjectBrainWatcher-demo.xml'), [
      '<service>',
      '  <executable>npx.cmd</executable>',
      '  <arguments>--yes github:horggorg88-pixel/project-brain-watcher#v1.4.4 service start</arguments>',
      '</service>',
    ].join('\n'), 'utf-8');

    const state = readServiceLauncherRepairState(profile);

    expect(state.requiresRepair).toBe(true);
    expect(state.reasons).toContain('service_xml_uses_npx_runner');
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

  it('reports command timeouts with a diagnostic message instead of a silent exit code', async () => {
    const result = await spawnWatcher(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 250)'],
      process.cwd(),
      {},
      { timeoutMs: 25, timeoutLabel: 'desktop update' },
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Команда прервана по таймауту: desktop update');
    expect(result.commandStatus.status).toBe('timed_out');
    expect(result.commandStatus.timedOut).toBe(true);
    expect(result.commandStatus.killed).toBe(true);
    expect(result.commandStatus.label).toBe('desktop update');
  });

  it('reports completed commands as machine-readable command status', async () => {
    const result = await spawnWatcher(
      process.execPath,
      ['-e', 'process.stdout.write("ok"); process.exit(0)'],
      process.cwd(),
      {},
      { timeoutMs: 500, timeoutLabel: 'desktop health' },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('ok');
    expect(result.commandStatus.status).toBe('completed');
    expect(result.commandStatus.exitCode).toBe(0);
    expect(result.commandStatus.killed).toBe(false);
    expect(result.commandStatus.label).toBe('desktop health');
  });

  it('reports spawn errors as machine-readable command status', async () => {
    const result = await spawnWatcher(
      'missing-watcher-command-for-test.exe',
      [],
      process.cwd(),
      {},
      { timeoutMs: 25, timeoutLabel: 'missing command' },
    );

    expect(result.exitCode).toBe(1);
    expect(result.commandStatus.status).toBe('spawn_error');
    expect(result.commandStatus.errorMessage).toBeTruthy();
    expect(result.commandStatus.label).toBe('missing command');
  });

  it('formats command status lines for watcher service logs', () => {
    expect(serviceCommandStatusLine({
      status: 'completed',
      command: 'node',
      label: 'desktop health',
      durationMs: 12,
      exitCode: 0,
      signal: null,
      timedOut: false,
      timeoutMs: 500,
      killed: false,
    })).toBe('Команда: desktop health, 12 мс, exitCode=0');
    expect(serviceCommandStatusLine({
      status: 'timed_out',
      command: 'node',
      label: 'desktop update',
      durationMs: 25,
      exitCode: null,
      signal: null,
      timedOut: true,
      timeoutMs: 25,
      killed: true,
    })).toBe('Команда: desktop update, 25 мс, таймаут 25 мс, процесс остановлен');
    expect(serviceCommandStatusLine({
      status: 'spawn_error',
      command: 'missing.exe',
      label: 'missing command',
      durationMs: 2,
      exitCode: 1,
      signal: null,
      timedOut: false,
      timeoutMs: 25,
      killed: false,
      errorMessage: 'not found',
    })).toBe('Команда: missing command, 2 мс, не запустилась: not found');
    expect(serviceCommandStatusLine({
      status: 'killed',
      command: 'node',
      label: 'desktop restart',
      durationMs: 8,
      exitCode: null,
      signal: 'SIGTERM',
      timedOut: false,
      timeoutMs: 500,
      killed: true,
    })).toBe('Команда: desktop restart, 8 мс, завершена сигналом SIGTERM');
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
