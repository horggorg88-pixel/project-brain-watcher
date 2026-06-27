import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  resolveServiceActionConfirmation,
  serviceActionProgressLines,
  serviceActionTimeoutLog,
  serviceActionTimeoutMs,
  type PendingServiceActionConfirmation,
} from '../../apps/watcher-desktop/src/renderer-service-ui.js';
import type { WatcherServiceStatus } from '../../apps/watcher-desktop/src/contracts.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const rendererSourcePath = resolve(testDir, '../../apps/watcher-desktop/src/renderer.ts');

function rendererSourceBlock(startMarker: string, endMarker: string): string {
  const source = readFileSync(rendererSourcePath, 'utf8');
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

describe('watcher desktop service UI confirmation', () => {
  it('prompts inline on the first mutating service action click', () => {
    const decision = resolveServiceActionConfirmation({
      action: 'start',
      confirmAction: true,
      nowMs: 1_000,
      pending: null,
      projectId: 'demo',
    });

    expect(decision.confirmed).toBe(false);
    expect(decision.pending).toEqual({ action: 'start', projectId: 'demo', expiresAt: 16_000 });
    expect(decision.message).toContain('нажмите эту же кнопку ещё раз');
  });

  it('confirms the second click for the same action and project before expiry', () => {
    const pending: PendingServiceActionConfirmation = { action: 'restart', projectId: 'demo', expiresAt: 20_000 };

    const decision = resolveServiceActionConfirmation({
      action: 'restart',
      confirmAction: true,
      nowMs: 12_000,
      pending,
      projectId: 'demo',
    });

    expect(decision.confirmed).toBe(true);
    expect(decision.pending).toBeNull();
    expect(decision.message).toBeNull();
  });

  it('does not confirm expired or different project actions', () => {
    const pending: PendingServiceActionConfirmation = { action: 'stop', projectId: 'demo', expiresAt: 20_000 };

    const expired = resolveServiceActionConfirmation({
      action: 'stop',
      confirmAction: true,
      nowMs: 20_001,
      pending,
      projectId: 'demo',
    });
    const differentProject = resolveServiceActionConfirmation({
      action: 'stop',
      confirmAction: true,
      nowMs: 12_000,
      pending,
      projectId: 'other',
    });

    expect(expired.confirmed).toBe(false);
    expect(differentProject.confirmed).toBe(false);
    expect(expired.pending?.projectId).toBe('demo');
    expect(differentProject.pending?.projectId).toBe('other');
  });

  it('allows health checks without a confirmation rail', () => {
    const pending: PendingServiceActionConfirmation = { action: 'start', projectId: 'demo', expiresAt: 20_000 };

    const decision = resolveServiceActionConfirmation({
      action: 'health',
      confirmAction: false,
      nowMs: 12_000,
      pending,
      projectId: 'demo',
    });

    expect(decision.confirmed).toBe(true);
    expect(decision.pending).toBeNull();
    expect(decision.message).toBeNull();
  });

  it('allows release update checks without a confirmation rail', () => {
    const pending: PendingServiceActionConfirmation = { action: 'restart', projectId: 'demo', expiresAt: 20_000 };

    const decision = resolveServiceActionConfirmation({
      action: 'check_update',
      confirmAction: false,
      nowMs: 12_000,
      pending,
      projectId: 'demo',
    });

    expect(decision.confirmed).toBe(true);
    expect(decision.pending).toBeNull();
    expect(decision.message).toBeNull();
  });

  it('renders update checks as a sequential update route, not a watcher startup checklist', () => {
    const lines = serviceActionProgressLines('check_update', 1_000);
    const text = lines.join('\n');

    expect(lines).toContain('Выполняем: Проверить обновления...');
    expect(lines).toContain('Команда: watcher.check_update · риск: низкий · timeout: 0:10');
    expect(lines).toContain('Текущий этап: Проверяем текущую версию пульта и watcher');
    expect(lines).toContain('Маршрут команды (полная трасса со статусами):');
    expect(lines).toContain('● 1/3 Сначала: Проверяем текущую версию пульта и watcher');
    expect(lines).toContain('○ 2/3 Затем: Запрашиваем последний GitHub release');
    expect(lines).toContain('○ 3/3 Финал: Сравниваем версии и формируем решение об обновлении');
    expect(text).not.toContain('Запуск Windows-службы');
    expect(text).not.toContain('Ожидание healthy');
  });

  it('marks completed, running and waiting stages when an operation has an active route step', () => {
    const lines = serviceActionProgressLines('update', 29_000, 2);

    expect(lines).toContain('Текущий этап: Проверяем подпись, размер и целостность скачанного release');
    expect(lines).toContain('✓ 1/7 Сначала: Проверяем текущую версию, профиль проекта и доступ к release');
    expect(lines).toContain('✓ 2/7 Затем: Скачиваем desktop installer и проверяем checksum');
    expect(lines).toContain('● 3/7 Затем: Проверяем подпись, размер и целостность скачанного release');
    expect(lines).toContain('○ 4/7 Затем: Запускаем установку desktop update');
    expect(lines).toContain('○ 5/7 Затем: Ставим локальный watcher runtime из release package');
    expect(lines).toContain('○ 6/7 Затем: Перезапускаем Windows-службу на новой версии');
    expect(lines).toContain('○ 7/7 Финал: Сверяем версии, healthy и итоговый статус службы');
  });

  it('estimates the active route step from elapsed time when no explicit step is available', () => {
    const lines = serviceActionProgressLines('check_update', 5_000);

    expect(lines).toContain('Текущий этап: Запрашиваем последний GitHub release');
    expect(lines).toContain('✓ 1/3 Сначала: Проверяем текущую версию пульта и watcher');
    expect(lines).toContain('● 2/3 Затем: Запрашиваем последний GitHub release');
    expect(lines).toContain('○ 3/3 Финал: Сравниваем версии и формируем решение об обновлении');
  });

  it('describes the local watchdog timeout for release update checks', () => {
    const text = serviceActionTimeoutLog('check_update');

    expect(serviceActionTimeoutMs('check_update')).toBe(10_000);
    expect(text).toContain('не завершилась за 0:10');
    expect(text).toContain('Пульт остановил ожидание локально');
    expect(text).toContain('GitHub release');
  });

  it('syncs startup progress with a healthy watcher status instead of stale timer stages', () => {
    const healthyStatus = {
      installed: true,
      running: true,
      health: 'healthy',
    } as WatcherServiceStatus;
    const lines = serviceActionProgressLines('start', 13_000, undefined, healthyStatus);
    const text = lines.join('\n');

    expect(lines).toContain('Что происходит сейчас: Watcher уже работает; визуал и логи синхронизированы.');
    expect(lines).toContain('Текущий этап: Watcher уже работает; визуал и логи синхронизированы');
    expect(lines).toContain('✓ 4/4 Финал: Собираем логи запуска и первопричину, если healthy не наступил');
    expect(text).not.toContain('● 2/4 Затем: Запускаем Windows-службу watcher');
    expect(text).not.toContain('○ 4/4 Финал: Собираем логи запуска и первопричину, если healthy не наступил');
  });

  it('moves startup progress to the health rail when the service process is already active', () => {
    const activeStatus = {
      installed: true,
      running: true,
      health: 'degraded',
      lastError: 'SSE reconnect waits for lease',
    } as WatcherServiceStatus;
    const lines = serviceActionProgressLines('start', 13_000, undefined, activeStatus);
    const text = lines.join('\n');

    expect(lines).toContain('Что происходит сейчас: Watcher уже запущен; ждём healthy, lease и первую синхронизацию.');
    expect(lines).toContain('✓ 2/4 Затем: Запускаем Windows-службу watcher');
    expect(lines).toContain('● 3/4 Затем: Ждём healthy, lease и первую синхронизацию');
    expect(lines).toContain('○ 4/4 Финал: Собираем логи запуска и первопричину, если healthy не наступил');
    expect(text).not.toContain('● 2/4 Затем: Запускаем Windows-службу watcher');
  });

  it('requires a same-action second click for every mutating service action', () => {
    const actions = ['install', 'start', 'stop', 'restart', 'update'] as const;

    for (const action of actions) {
      const firstClick = resolveServiceActionConfirmation({
        action,
        confirmAction: true,
        nowMs: 1_000,
        pending: null,
        projectId: 'demo',
      });
      const secondClick = resolveServiceActionConfirmation({
        action,
        confirmAction: true,
        nowMs: 2_000,
        pending: firstClick.pending,
        projectId: 'demo',
      });

      expect(firstClick.confirmed).toBe(false);
      expect(firstClick.pending).toEqual({ action, projectId: 'demo', expiresAt: 16_000 });
      expect(firstClick.message).toContain('нажмите эту же кнопку ещё раз');
      expect(secondClick.confirmed).toBe(true);
      expect(secondClick.pending).toBeNull();
    }
  });
});

describe('watcher desktop service action lifecycle', () => {
  it('stops progress before writing the final service action log', () => {
    const block = rendererSourceBlock(
      'async function runServiceActionFromUi',
      'function runServiceActionWithUiTimeout',
    );

    expect(block).toMatch(/stopActionProgress\(\);\s+writeLog\(serviceActionLog\(result\)\);\s+queuePostServiceActionRefresh\(action\);/);
    expect(block).not.toContain('writeLog(serviceActionLog(result));\n    await refresh();');
  });

  it('cancels in-flight progress sync callbacks after the route is stopped', () => {
    const block = rendererSourceBlock(
      'function startServiceActionProgress',
      'async function serviceAiLogsText',
    );

    expect(block).toContain('let cancelled = false;');
    expect(block).toContain('if (cancelled) return;');
    expect(block).toContain('if (syncInFlight || cancelled) return;');
    expect(block).toContain('cancelled = true;');
  });

  it('keeps late service action final logs visible after the UI timeout', () => {
    const block = rendererSourceBlock(
      'function runServiceActionWithUiTimeout',
      'function queuePostServiceActionRefresh',
    );

    expect(block).toContain('let timedOut = false;');
    expect(block).toContain('timedOut = true;');
    expect(block).toContain('Пульт не отменил команду в службе.');
    expect(block).toContain('writeLog(lateServiceActionCompletionLog(request.action, result));');
    expect(block).toContain('writeLog(lateServiceActionFailureLog(request.action, error));');
    expect(block).toContain('queuePostServiceActionRefresh(request.action);');
    expect(block).not.toContain('.then(resolve, reject)');
  });
});
