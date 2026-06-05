import type {
  DesktopCheckNode,
  DesktopConnectionCheck,
  DiagnosticsPreview,
  SavedProjectProfile,
  WatcherServiceStatus,
} from './contracts.js';
import { discoverMcpConfig } from './desktop-config-discovery.js';
import { previewDiagnostics } from './desktop-core.js';
import { defaultProfile, readProfiles, type DesktopCorePaths } from './desktop-profile-store.js';
import { verifyProjectServerAccess } from './desktop-server-access.js';
import { readDesktopServiceSecret, readDesktopServiceSecretState } from './desktop-service-secret.js';
import { readServiceStatus } from './desktop-service-status.js';

export async function buildDesktopConnectionCheck(
  paths: DesktopCorePaths,
  projectId: string,
): Promise<DesktopConnectionCheck> {
  const profiles = readProfiles(paths);
  const profile = resolveProfile(paths, profiles, projectId);
  const config = discoverMcpConfig(paths);
  const secret = readDesktopServiceSecretState(profile);
  const token = profile ? readDesktopServiceSecret(profile) : null;
  const service = readServiceStatus(paths);
  const diagnostics = previewDiagnostics(paths);
  const server = profile ? await verifyProjectServerAccess(profile, token) : null;
  const nodes = buildNodes({ profile, configFound: config.found, secretConfigured: secret.configured, serverVerified: server?.verified ?? false, service });
  const overall = resolveOverall(nodes);
  return {
    overall,
    message: statusMessage(overall),
    projectId: profile?.id ?? null,
    checkedAt: new Date().toISOString(),
    nodes,
    service,
    diagnostics,
  };
}

function resolveProfile(
  paths: DesktopCorePaths,
  profiles: readonly SavedProjectProfile[],
  projectId: string,
): SavedProjectProfile | null {
  return profiles.find(profile => profile.id === projectId) ?? profiles[0] ?? defaultProfile(paths);
}

function buildNodes(input: {
  readonly profile: SavedProjectProfile | null;
  readonly configFound: boolean;
  readonly secretConfigured: boolean;
  readonly serverVerified: boolean;
  readonly service: WatcherServiceStatus;
}): readonly DesktopCheckNode[] {
  return [
    node('project', 'Проект', Boolean(input.profile), input.profile?.root ?? 'Выберите папку проекта', 'select_project', 'Выбрать папку'),
    node('config', 'MCP-конфиг', input.configFound, input.configFound ? 'Файл настройки найден' : 'Импортируйте или скачайте конфиг', 'import_config', 'Импортировать'),
    node('key', 'Барьер-ключ', input.secretConfigured, input.secretConfigured ? 'Ключ сохранён локально' : 'Ключ не найден в secret-файле', 'download_config', 'Скачать пакет'),
    node('server', 'MCP-сервер', input.serverVerified, input.serverVerified ? 'Сервер подтвердил доступ' : 'Сервер не подтвердил bearer/session', 'verify', 'Проверить'),
    node('watcher', 'Watcher-служба', input.service.running && input.service.health === 'healthy', serviceDetail(input.service), 'start_service', 'Запустить'),
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

function statusMessage(overall: DesktopConnectionCheck['overall']): string {
  if (overall === 'ready') return 'Готово';
  if (overall === 'error') return 'Ошибка';
  return 'Требуется действие';
}

function serviceDetail(service: WatcherServiceStatus): string {
  if (!service.installed) return 'Служба не установлена';
  if (!service.running) return 'Служба остановлена';
  return service.lastError ?? 'Служба работает';
}
