import { describe, expect, it } from 'vitest';

import { buildDesktopCommandRouteSnapshot } from '../../apps/watcher-desktop/src/desktop-command-route.js';
import { descriptorForCommand } from '../../apps/watcher-desktop/src/desktop-command-registry.js';

describe('watcher desktop command route snapshots', () => {
  it('estimates the active route stage from elapsed time and command timeout', () => {
    const snapshot = buildDesktopCommandRouteSnapshot({
      descriptor: descriptorForCommand('watcher.check_update'),
      elapsedMs: 5_000,
    });

    expect(snapshot.currentStepId).toBe('github_release');
    expect(snapshot.currentText).toBe('Запрашиваем последний GitHub release');
    expect(snapshot.elapsedText).toBe('0:05');
    expect(snapshot.timeoutText).toBe('0:10');
    expect(snapshot.evidenceText).toBe('desktop.version, watcher.version, github.release');
    expect(snapshot.finalLog).toBe('есть ли новая версия, какая версия локально и какая доступна в GitHub release');
    expect(snapshot.stages.map(stage => [stage.marker, stage.ordinal, stage.label])).toEqual([
      ['✓', 'Сначала', 'Проверяем текущую версию пульта и watcher'],
      ['●', 'Затем', 'Запрашиваем последний GitHub release'],
      ['○', 'Финал', 'Сравниваем версии и формируем решение об обновлении'],
    ]);
  });

  it('uses explicit active step ids before elapsed-time guesses', () => {
    const snapshot = buildDesktopCommandRouteSnapshot({
      descriptor: descriptorForCommand('watcher.check_update'),
      elapsedMs: 1_000,
      activeStepId: 'compare_versions',
    });

    expect(snapshot.currentStepId).toBe('compare_versions');
    expect(snapshot.stages.map(stage => stage.status)).toEqual(['passed', 'passed', 'active']);
  });

  it('marks every route stage as passed when the command has settled', () => {
    const snapshot = buildDesktopCommandRouteSnapshot({
      descriptor: descriptorForCommand('watcher.start'),
      elapsedMs: 13_000,
      settledText: 'Watcher уже работает; визуал и логи синхронизированы',
    });

    expect(snapshot.currentText).toBe('Watcher уже работает; визуал и логи синхронизированы');
    expect(snapshot.currentStepId).toBe('diagnostics');
    expect(snapshot.stages.every(stage => stage.status === 'passed')).toBe(true);
    expect(snapshot.stages.every(stage => stage.marker === '✓')).toBe(true);
  });
});
