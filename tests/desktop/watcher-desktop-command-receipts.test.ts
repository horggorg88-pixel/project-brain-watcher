import { describe, expect, it } from 'vitest';
import type {
  WatcherCommandStatus,
  WatcherServiceActionResult,
  WatcherServiceLogTail,
  WatcherServiceStatus,
} from '../../apps/watcher-desktop/src/contracts.js';
import {
  allDesktopCommandDescriptors,
  descriptorForCommand,
  supportCommandId,
  watcherServiceCommandId,
} from '../../apps/watcher-desktop/src/desktop-command-registry.js';
import {
  attachServiceCommandReceipt,
  buildServiceCommandReceipt,
  serviceCommandStatus,
} from '../../apps/watcher-desktop/src/desktop-command-receipts.js';

describe('watcher desktop command receipts', () => {
  it('declares one registry descriptor for every P0 desktop command', () => {
    const ids = allDesktopCommandDescriptors().map(descriptor => descriptor.id);

    expect(ids).toEqual(expect.arrayContaining([
      'watcher.health',
      'watcher.install',
      'watcher.start',
      'watcher.stop',
      'watcher.restart',
      'watcher.check_update',
      'watcher.update',
      'codex.verify_gates',
      'mcp.refresh_config',
      'diagnostics.collect',
      'support.collect_diagnostics',
      'support.repair_watcher_service',
      'support.restart_watcher',
      'support.update_watcher',
      'support.verify_codex_gates',
      'support.refresh_mcp_config',
      'support.mesh_status',
    ]));
    expect(new Set(ids).size).toBe(ids.length);
    expect(descriptorForCommand('watcher.update').timeoutMs).toBe(600_000);
    expect(descriptorForCommand('watcher.update').requiredEvidence).toContain('runtime-install.log');
    expect(descriptorForCommand('support.repair_watcher_service').requiredEvidence).toContain('service.receipt');
  });

  it('maps watcher and support actions to stable command ids', () => {
    expect(watcherServiceCommandId('check_update')).toBe('watcher.check_update');
    expect(watcherServiceCommandId('update')).toBe('watcher.update');
    expect(supportCommandId('refresh_mcp_config')).toBe('support.refresh_mcp_config');
  });

  it('turns service progress, cause and log cursors into a machine-readable receipt', () => {
    const result = resultFixture({
      exitCode: 1,
      commandStatus: commandStatusFixture({ status: 'timed_out', timedOut: true, exitCode: null }),
      primaryCause: {
        code: 'COMMAND_TIMEOUT',
        severity: 'error',
        title: 'Команда службы превысила таймаут',
        detail: 'service start выполнялась 60009 мс и была остановлена.',
        nextAction: 'Смотри live-прогресс и последние логи.',
      },
      progress: {
        action: 'start',
        label: 'Запустить watcher',
        startedAt: '2026-06-26T10:00:00.000Z',
        elapsedMs: 60_009,
        activeStepId: 'command',
        summary: 'Команда службы превысила таймаут',
        primaryCause: null,
        steps: [
          { id: 'preflight', label: 'Профиль', status: 'passed', detail: 'ok' },
          { id: 'command', label: 'Команда', status: 'failed', detail: 'timeout' },
        ],
      },
      status: statusFixture({ logs: logsFixture() }),
    });

    const receipt = buildServiceCommandReceipt({
      action: 'start',
      result,
      receivedAt: '2026-06-26T10:01:00.000Z',
    });

    expect(receipt.version).toBe('desktop-command-receipt/v1');
    expect(receipt.commandId).toBe('watcher.start');
    expect(receipt.status).toBe('timed_out');
    expect(receipt.ackState).toBe('local_committed');
    expect(receipt.logCursor).toBe('err:cursor-err-tail');
    expect(receipt.diagnostic?.code).toBe('COMMAND_TIMEOUT');
    expect(receipt.steps.map(step => step.id)).toEqual(['preflight', 'command']);
    expect(receipt.receiptId).toMatch(/^dcr_[a-f0-9]{20}$/);
    expect(receipt.runId).toMatch(/^dcrun_[a-f0-9]{18}$/);
  });

  it('attaches receipts and preserves the original service result', () => {
    const result = resultFixture({ exitCode: 0 });

    const withReceipt = attachServiceCommandReceipt('health', result, '2026-06-26T10:01:00.000Z');

    expect(withReceipt.output).toBe(result.output);
    expect(withReceipt.receipt?.commandId).toBe('watcher.health');
    expect(withReceipt.receipt?.status).toBe('passed');
  });

  it('normalizes policy and command outcomes into command statuses', () => {
    expect(serviceCommandStatus(resultFixture({
      policy: { decision: 'deny', risk: 'high', reasons: ['blocked'] },
      exitCode: null,
    }))).toBe('blocked');
    expect(serviceCommandStatus(resultFixture({
      policy: { decision: 'prompt', risk: 'high', reasons: ['confirm'] },
      exitCode: null,
    }))).toBe('waiting');
    expect(serviceCommandStatus(resultFixture({
      commandStatus: commandStatusFixture({ status: 'spawn_error', exitCode: 1, timedOut: false }),
      exitCode: 1,
    }))).toBe('failed');
  });
});

function resultFixture(overrides: Partial<WatcherServiceActionResult>): WatcherServiceActionResult {
  return {
    executed: true,
    policy: { decision: 'allow', risk: 'low', reasons: ['ok'] },
    status: statusFixture({}),
    exitCode: 0,
    output: 'ok',
    ...overrides,
  };
}

function statusFixture(overrides: Partial<WatcherServiceStatus>): WatcherServiceStatus {
  return {
    installed: true,
    running: false,
    readOnly: false,
    health: 'stopped',
    projectId: 'demo',
    root: 'C:\\repo',
    pid: null,
    queueDepth: 0,
    lastSyncAt: null,
    lastError: null,
    logs: null,
    ...overrides,
  };
}

function commandStatusFixture(overrides: Partial<WatcherCommandStatus>): WatcherCommandStatus {
  return {
    status: 'completed',
    label: 'service start',
    command: 'node',
    exitCode: 0,
    signal: null,
    durationMs: 60_009,
    timeoutMs: 60_000,
    timedOut: false,
    killed: false,
    ...overrides,
  };
}

function logsFixture(): WatcherServiceLogTail {
  return {
    wrapperPath: 'wrapper.log',
    outPath: 'out.log',
    errPath: 'err.log',
    runtimeInstallPath: 'runtime-install.log',
    wrapper: '',
    out: '',
    err: 'timeout',
    runtimeInstall: '',
    transport: {
      version: 'watcher-log-transport/v1',
      chunkSizeBytes: 24000,
      streams: [
        {
          id: 'out',
          label: 'out',
          path: 'out.log',
          exists: true,
          sizeBytes: 1,
          modifiedAt: null,
          tail: { offset: 0, bytes: 1, truncated: false },
          firstCursor: 'cursor-out-first',
          tailCursor: 'cursor-out-tail',
        },
        {
          id: 'err',
          label: 'err',
          path: 'err.log',
          exists: true,
          sizeBytes: 1,
          modifiedAt: null,
          tail: { offset: 0, bytes: 1, truncated: false },
          firstCursor: 'cursor-err-first',
          tailCursor: 'cursor-err-tail',
        },
      ],
    },
  };
}
