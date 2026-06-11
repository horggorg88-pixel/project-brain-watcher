import type { DesktopModeRailStage, DesktopModeSummary, DesktopModeStatus } from './contracts.js';
import { desktopModeCatalog, type DesktopModeCatalogEntry } from './desktop-mode-catalog.js';
import { discoverMcpConfig } from './desktop-config-discovery.js';
import { previewDiagnostics } from './desktop-core.js';
import { type DesktopCorePaths } from './desktop-profile-store.js';
import { readServiceStatus } from './desktop-service-status.js';

interface ModeRuntimeState {
  readonly configFound: boolean;
  readonly runtimeReady: boolean;
  readonly operatorReady: boolean;
  readonly diagnosticsAllowed: boolean;
  readonly serviceInstalled: boolean;
  readonly serviceRunning: boolean;
  readonly serviceHealthy: boolean;
  readonly serviceHealthDetail: string;
}

export function listDesktopModeSummaries(paths: DesktopCorePaths, projectId?: string): readonly DesktopModeSummary[] {
  const config = discoverMcpConfig(paths);
  const diagnostics = previewDiagnostics(paths, projectId);
  const service = readServiceStatus(paths, projectId);
  const state: ModeRuntimeState = {
    configFound: config.found,
    runtimeReady: config.found && diagnostics.readiness !== 'deny',
    operatorReady: config.found && diagnostics.readiness !== 'deny' && service.running,
    diagnosticsAllowed: diagnostics.readiness !== 'deny',
    serviceInstalled: service.installed,
    serviceRunning: service.running,
    serviceHealthy: service.health === 'healthy',
    serviceHealthDetail: service.lastError ?? service.health,
  };

  return desktopModeCatalog.map(entry => mode(entry, modeStatus(entry.id, state), rails(entry.id, state)));
}

function mode(
  entry: DesktopModeCatalogEntry,
  status: DesktopModeStatus,
  railStages: readonly DesktopModeRailStage[],
): DesktopModeSummary {
  return {
    ...entry,
    status,
    primaryAction: status === 'ready' ? 'Открыть рельсы' : 'Проверить',
    rails: railStages,
  };
}

function modeStatus(id: string, state: ModeRuntimeState): DesktopModeStatus {
  if (id === 'brain') return state.configFound ? 'ready' : 'error';
  if (id === 'swarm' || id === 'watcher') return state.serviceRunning ? 'ready' : 'action_required';
  if (id === 'consultation') return state.configFound ? 'ready' : 'action_required';
  if (id === 'active') return state.operatorReady ? 'ready' : 'action_required';
  return state.runtimeReady ? 'ready' : 'action_required';
}

function rails(id: string, state: ModeRuntimeState): readonly DesktopModeRailStage[] {
  switch (id) {
    case 'brain':
      return [
        rail('config', 'MCP config', state.configFound, state.configFound ? 'Найден' : 'Не найден'),
        rail('context', 'Context tools', state.runtimeReady, state.runtimeReady ? 'Можно читать через MCP' : 'Нужна настройка'),
        rail('watcher', 'Watcher', state.serviceRunning, state.serviceRunning ? 'Активен' : 'Не активен'),
      ];
    case 'wave':
      return [
        rail('runtime', 'Runtime', state.runtimeReady, state.runtimeReady ? 'Готов' : 'Нужен runtime_start'),
        rail('policy', 'Policy', state.diagnosticsAllowed, 'Policy gate'),
        rail('completion', 'Completion', state.runtimeReady, 'Rail completion'),
      ];
    case 'idol':
      return [
        rail('cycle', 'Cycle ledger', state.runtimeReady, 'Циклы фиксируются'),
        rail('agents', 'Agent receipts', state.runtimeReady, 'Агентские receipts обязательны'),
        rail('scorecard', 'Scorecard', state.runtimeReady, 'Итоговая оценка'),
      ];
    case 'swarm':
      return [
        rail('service', 'Watcher service', state.serviceRunning, state.serviceRunning ? 'Готов' : 'Служба не запущена'),
        rail('branch', 'Branch applier', state.serviceRunning, 'Применение через watcher'),
        rail('review', 'Review', state.runtimeReady, 'Нужна проверка diff'),
      ];
    case 'watcher':
      return [
        rail('install', 'Install', state.serviceInstalled, state.serviceInstalled ? 'Установлен' : 'Нужна установка'),
        rail('run', 'Run', state.serviceRunning, state.serviceRunning ? 'Запущен' : 'Остановлен'),
        rail('sync', 'Sync', state.serviceHealthy, state.serviceHealthDetail),
      ];
    case 'active':
      return [
        rail('plan', 'Plan', true, 'План до первого изменения'),
        rail('edit', 'Mutation', state.operatorReady, state.operatorReady ? 'Можно работать' : 'Нужны watcher/runtime'),
        rail('verify', 'Verify', state.runtimeReady, 'Сборка и тесты обязательны'),
      ];
    case 'fix-loop':
      return [
        rail('reproduce', 'Reproduce', true, 'Сначала воспроизведение'),
        rail('root-cause', 'Root cause', state.runtimeReady, 'Причина подтверждается данными'),
        rail('fix', 'Fix gate', false, 'Правки только после разрешения'),
      ];
    case 'deep-analysis':
      return [
        rail('request', 'Request critique', true, 'Уточняется смысл запроса'),
        rail('evidence', 'Evidence', state.runtimeReady, 'Контекст из MCP'),
        rail('recommend', 'Recommendation', true, 'Итог с рисками'),
      ];
    case 'review':
      return [
        rail('diff', 'Diff', true, 'Проверка изменений'),
        rail('risk', 'Risk scan', state.runtimeReady, 'Риски и регрессии'),
        rail('tests', 'Test gaps', true, 'Дыры покрытия'),
      ];
    case 'council':
      return [
        rail('roles', 'Roles', state.runtimeReady, 'Роли берутся из памяти/MCP'),
        rail('vote', 'Decision', true, 'Решение фиксируется'),
        rail('handoff', 'Handoff', true, 'Переход к реализации'),
      ];
    case 'audit':
      return [
        rail('study', 'Study', state.runtimeReady, 'MCP-only изучение'),
        rail('survey', 'Survey', true, 'Вопросы блоками'),
        rail('implement', 'Implement', false, 'Только после плана'),
      ];
    case 'refactor':
      return [
        rail('detect', 'Detect', state.runtimeReady, 'Поиск god-файлов'),
        rail('dry-run', 'Dry run', true, 'План до правки'),
        rail('rollback', 'Rollback', true, 'Откат при compile fail'),
      ];
    case 'runtime-policy-gates':
      return [
        rail('runtime', 'Runtime', state.runtimeReady, state.runtimeReady ? 'Сессия готова' : 'Нужен runtime_start'),
        rail('policy', 'Policy', state.diagnosticsAllowed, 'Контракт режима'),
        rail('gates', 'Gates', state.runtimeReady, 'Проход этапов'),
      ];
    case 'todoist-sync':
      return [
        rail('brain', 'Brain first', state.runtimeReady, 'Сначала remember'),
        rail('todoist', 'Todoist', false, 'Нужна внешняя привязка'),
        rail('report', 'Report', true, 'Готовый отчёт'),
      ];
    default:
      return [
        rail('scope', 'Read only', true, 'Без проектных изменений'),
        rail('context', 'MCP context', state.configFound, state.configFound ? 'Контекст доступен' : 'Нужен MCP-конфиг'),
        rail('handoff', 'Decision', true, 'После консультации можно перейти к делай'),
      ];
  }
}

function rail(id: string, label: string, active: boolean, detail: string): DesktopModeRailStage {
  return { id, label, active, detail };
}
