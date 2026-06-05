import type { DesktopModeSummary, DesktopModeStatus } from './contracts.js';
import { discoverMcpConfig } from './desktop-config-discovery.js';
import { previewDiagnostics } from './desktop-core.js';
import { type DesktopCorePaths } from './desktop-profile-store.js';
import { readServiceStatus } from './desktop-service-status.js';

export function listDesktopModeSummaries(paths: DesktopCorePaths): readonly DesktopModeSummary[] {
  const config = discoverMcpConfig(paths);
  const diagnostics = previewDiagnostics(paths);
  const service = readServiceStatus(paths);
  const runtimeReady = config.found && diagnostics.readiness !== 'deny';
  return [
    mode('brain', 'Brain', 'brain_status', config.found ? 'ready' : 'error', 'Контекст проекта и карта кода', [
      ['config', 'MCP config', config.found, config.found ? 'Найден' : 'Не найден'],
      ['context', 'Context tools', runtimeReady, runtimeReady ? 'Можно читать через MCP' : 'Нужна настройка'],
      ['watcher', 'Watcher', service.running, service.running ? 'Активен' : 'Не активен'],
    ]),
    mode('wave', 'Wave', 'operator_workflow:wave', runtimeReady ? 'ready' : 'action_required', 'Три волны и пять агентов через operator rails', [
      ['runtime', 'Runtime', runtimeReady, runtimeReady ? 'Готов' : 'Нужен runtime_start'],
      ['policy', 'Policy', diagnostics.readiness !== 'deny', 'Policy gate'],
      ['completion', 'Completion', runtimeReady, 'Rail completion'],
    ]),
    mode('idol', 'Idol', 'operator_workflow:idol', runtimeReady ? 'ready' : 'action_required', 'Циклы idol с wave-внутренностями и evidence gates', [
      ['cycle', 'Cycle ledger', runtimeReady, 'Циклы фиксируются'],
      ['agents', 'Agent receipts', runtimeReady, 'Агентские receipts обязательны'],
      ['scorecard', 'Scorecard', runtimeReady, 'Итоговая оценка'],
    ]),
    mode('swarm', 'Swarm', 'swarm_start', service.running ? 'ready' : 'action_required', 'Параллельные агенты через watcher applier', [
      ['service', 'Watcher service', service.running, service.running ? 'Готов' : 'Служба не запущена'],
      ['branch', 'Branch applier', service.running, 'Применение через watcher'],
      ['review', 'Review', runtimeReady, 'Нужна проверка diff'],
    ]),
    mode('watcher', 'Watcher', 'project-brain-watcher', service.running ? 'ready' : 'action_required', 'Локальная служба индексации и доставки изменений', [
      ['install', 'Install', service.installed, service.installed ? 'Установлен' : 'Нужна установка'],
      ['run', 'Run', service.running, service.running ? 'Запущен' : 'Остановлен'],
      ['sync', 'Sync', service.health === 'healthy', service.lastError ?? service.health],
    ]),
  ];
}

function mode(
  id: string,
  title: string,
  technicalName: string,
  status: DesktopModeStatus,
  summary: string,
  rails: readonly (readonly [string, string, boolean, string])[],
): DesktopModeSummary {
  return {
    id,
    title,
    technicalName,
    status,
    summary,
    primaryAction: status === 'ready' ? 'Открыть рельсы' : 'Проверить',
    rails: rails.map(([stageId, label, active, detail]) => ({ id: stageId, label, active, detail })),
  };
}
