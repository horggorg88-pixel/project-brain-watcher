import { describe, expect, it } from 'vitest';
import { formatCodexGateDiagnostics } from '../../apps/watcher-desktop/src/renderer-view.js';
import type { DesktopCodexGateRunEvidence, DesktopCodexGateStatus } from '../../apps/watcher-desktop/src/contracts.js';

describe('watcher desktop Codex gate diagnostics', () => {
  it('renders the quality gate rail state algebra and diagnostic message contract', () => {
    const status = {
      ready: false,
      message: 'Quality gate evidence contract check.',
      checkedAt: '2026-07-01T00:10:00.000Z',
      evidence: {
        commandRuns: {
          codexHooks: {
            available: false,
            checkedAt: '2026-07-01T00:00:00.000Z',
            staleAfterMs: 60_000,
            source: 'desktop-codex-gates',
            command: 'codex plugin add persistent-verifier@claude-migrated-home',
            detail: 'codex hooks unavailable but evidence is expired',
          },
          typecheck: qualityRun({
            passed: true,
            checkedAt: '2026-07-01T00:00:00.000Z',
            staleAfterMs: 60_000,
            command: 'npm run typecheck',
            detail: 'typecheck passed but evidence is expired',
          }),
          lint: qualityRun({
            passed: true,
            checkedAt: '2026-07-01T00:10:00.000Z',
            staleAfterMs: 60_000,
            command: 'npm run lint',
            detail: 'lint passed',
          }),
          test: qualityRun({
            passed: false,
            checkedAt: '2026-07-01T00:10:00.000Z',
            staleAfterMs: 60_000,
            command: 'npm test',
            detail: 'tests failed',
            exitCode: 1,
          }),
          build: qualityRun({
            passed: true,
            checkedAt: '2026-07-01T00:10:00.000Z',
            staleAfterMs: 60_000,
            command: 'npm run build',
            detail: 'build passed',
          }),
          check: qualityRun({
            passed: true,
            checkedAt: 'not-a-date',
            staleAfterMs: 60_000,
            command: 'npm run check',
            detail: 'check timestamp is invalid',
          }),
          verify: {
            available: false,
            checkedAt: '2026-07-01T00:10:00.000Z',
            staleAfterMs: 60_000,
            source: 'quality-gate-runner',
            command: 'detect verify',
            detail: 'verify command unavailable',
          },
        },
        verification: {},
      },
    } satisfies DesktopCodexGateStatus;

    const log = formatCodexGateDiagnostics(status, 'quality-project');

    expect(log).toContain('projectId: quality-project');
    expect(log).toContain('ready: нет');
    expect(log).toContain('checkedAt: 2026-07-01T00:10:00.000Z');
    expect(log).toContain('message: Quality gate evidence contract check.');
    expect(log).toContain('Persistent verifier hooks (codexHooks): stale');
    expect(log).not.toContain('Persistent verifier hooks (codexHooks): unavailable');
    expect(log).toContain('Quality typecheck (typecheck): stale');
    expect(log).not.toContain('Quality typecheck (typecheck): passed');
    expect(log).toContain('command=npm run typecheck');
    expect(log).toContain('detail=typecheck passed but evidence is expired');
    expect(log).toContain('source=quality-gate-runner');
    expect(log).toContain('Quality lint (lint): passed');
    expect(log).toContain('command=npm run lint');
    expect(log).toContain('Quality test (test): failed');
    expect(log).toContain('exit=1');
    expect(log).toContain('command=npm test');
    expect(log).toContain('Quality build (build): passed');
    expect(log).toContain('command=npm run build');
    expect(log).toContain('Quality check (check): stale');
    expect(log).toContain('command=npm run check');
    expect(log).toContain('Quality verify (verify): unavailable');
    expect(log).toContain('command=detect verify');
  });
});

function qualityRun(overrides: {
  readonly passed: boolean;
  readonly checkedAt: string;
  readonly staleAfterMs: number;
  readonly command: string;
  readonly detail: string;
  readonly exitCode?: number;
}): DesktopCodexGateRunEvidence {
  return {
    available: true,
    passed: overrides.passed,
    checkedAt: overrides.checkedAt,
    staleAfterMs: overrides.staleAfterMs,
    source: 'quality-gate-runner',
    command: overrides.command,
    detail: overrides.detail,
    exitCode: overrides.exitCode ?? 0,
  };
}
