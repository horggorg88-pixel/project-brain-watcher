import type {
  DesktopCheckNode,
  DesktopConnectionCheck,
  DiagnosticsPreview,
  SavedProjectProfile,
  WatcherServiceStatus,
} from './contracts.js';
import { readDesktopCodexGateEvidence } from './desktop-codex-gates.js';
import { discoverMcpConfig } from './desktop-config-discovery.js';
import { previewDiagnostics } from './desktop-core.js';
import { applyMcpConfigToProfile, type DesktopCorePaths } from './desktop-profile-store.js';
import { verifyProjectServerAccess } from './desktop-server-access.js';
import {
  readDesktopServiceSecretState,
  readDesktopServiceToken,
  syncDesktopServiceSecretFromProjectMcp,
} from './desktop-service-secret.js';
import { readServiceStatus, resolveServiceProfile } from './desktop-service-status.js';

export async function buildDesktopConnectionCheck(
  paths: DesktopCorePaths,
  projectId: string,
): Promise<DesktopConnectionCheck> {
  const config = discoverMcpConfig(paths);
  const profile = applyMcpConfigToProfile(resolveServiceProfile(paths, projectId), config);
  if (profile) syncDesktopServiceSecretFromProjectMcp(profile);
  const secret = readDesktopServiceSecretState(profile);
  const token = profile ? readDesktopServiceToken(profile) : null;
  const scopedProjectId = profile?.id ?? projectId;
  const service = readServiceStatus(paths, scopedProjectId);
  const diagnostics = previewDiagnostics(paths, scopedProjectId);
  const server = profile ? await verifyProjectServerAccess(profile, token) : null;
  const codexGates = readDesktopCodexGateEvidence(paths, scopedProjectId);
  const nodes = buildNodes({
    profile,
    configFound: config.found,
    secretConfigured: secret.configured,
    serverMessage: server?.message ?? null,
    serverVerified: server?.verified ?? false,
    codexGatesReady: codexGates.ready,
    codexGatesMessage: codexGates.message,
    service,
  });
  const overall = resolveOverall(nodes);
  return {
    overall,
    message: statusMessage(overall, nodes),
    projectId: profile?.id ?? null,
    checkedAt: new Date().toISOString(),
    nodes,
    codexGates,
    service,
    diagnostics,
  };
}

function buildNodes(input: {
  readonly profile: SavedProjectProfile | null;
  readonly configFound: boolean;
  readonly secretConfigured: boolean;
  readonly serverMessage: string | null;
  readonly serverVerified: boolean;
  readonly codexGatesReady: boolean;
  readonly codexGatesMessage: string;
  readonly service: WatcherServiceStatus;
}): readonly DesktopCheckNode[] {
  const serverDetail = input.serverVerified
    ? 'Сервер подтвердил доступ'
    : input.serverMessage ?? 'Пульт не может подтвердить доступ к MCP-серверу';
  return [
    node('project', 'Проект', Boolean(input.profile), input.profile?.root ?? 'Выберите папку проекта', 'select_project', 'Выбрать папку'),
    node('config', 'Файл настройки', input.configFound, input.configFound ? 'Файл настройки принят' : 'Импортируйте файл из личного кабинета', 'import_config', 'Импортировать файл'),
    node('key', 'Ключ доступа', input.secretConfigured, input.secretConfigured ? 'Ключ сохранён локально' : 'Пульт не нашёл локальный ключ', 'download_config', 'Скачать пакет'),
    node('server', 'MCP-сервер', input.serverVerified, serverDetail, 'open_logs', input.serverVerified ? 'Проверить MCP' : 'Показать причину'),
    node('codexGates', 'Codex Gates', input.codexGatesReady, input.codexGatesMessage, 'verify_codex_gates', 'Проверить Codex'),
    node('watcher', 'Watcher', input.service.running && input.service.health === 'healthy', serviceDetail(input.service), serviceAction(input.service), serviceActionLabel(input.service)),
  ];
}

function node(
  id: string,
  label: string,
  ok: boolean,
  detail: string,
  action: DesktopCheckNode['action'],
  actionLabel: string,
): DesktopCheckNode {
  return { id, label, status: ok ? 'active' : 'inactive', detail, action: ok ? 'none' : action, actionLabel: ok ? null : actionLabel };
}

function resolveOverall(nodes: readonly DesktopCheckNode[]): DesktopConnectionCheck['overall'] {
  const inactive = nodes.filter(item => item.status !== 'active');
  if (inactive.some(item => item.id === 'project' || item.id === 'config')) return 'error';
  return inactive.length ? 'action_required' : 'ready';
}

function statusMessage(overall: DesktopConnectionCheck['overall'], nodes: readonly DesktopCheckNode[]): string {
  if (overall === 'ready') return 'Подключение готово';
  const blocker = nodes.find(item => item.status !== 'active');
  const reason = blocker ? `${blocker.label}: ${blocker.detail}` : 'причина не определена';
  if (overall === 'error') return `Проверка остановлена. Причина: ${reason}`;
  return `Остался шаг подключения. Причина: ${reason}`;
}

function serviceDetail(service: WatcherServiceStatus): string {
  if (!service.installed) return 'Watcher не установлен';
  if (!service.running) return 'Watcher остановлен';
  if (service.lastError) return `Watcher сообщает: ${service.lastError}`;
  return 'Watcher работает';
}

function serviceAction(service: WatcherServiceStatus): DesktopCheckNode['action'] {
  return service.installed ? 'start_service' : 'install_service';
}

function serviceActionLabel(service: WatcherServiceStatus): string {
  return service.installed ? 'Запустить watcher' : 'Установить службу';
}
