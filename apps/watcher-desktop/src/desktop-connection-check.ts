import type {
  DesktopCheckNode,
  DesktopCodexGateRunEvidence,
  DesktopCodexGateStatus,
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
    codexGates,
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
    mcpIndex: server?.mcpIndex ?? null,
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
  readonly codexGates: DesktopCodexGateStatus;
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
    codexTrustNode(input.codexGates),
    codexGateNode(input.codexGates),
    node('watcher', 'Watcher', serviceReady(input.service), serviceDetail(input.service), serviceAction(input.service), serviceActionLabel(input.service)),
  ];
}

function codexTrustNode(status: DesktopCodexGateStatus): DesktopCheckNode {
  const trust = status.evidence.verification.codexTrust;
  if (trust && hasCurrentPassed(trust, status.checkedAt)) {
    return {
      id: 'codexTrust',
      label: 'Codex Trust',
      status: 'active',
      detail: trust.detail,
      action: 'none',
      actionLabel: null,
    };
  }
  if (trust?.available === true && trust.passed === false) {
    return {
      id: 'codexTrust',
      label: 'Codex Trust',
      status: 'inactive',
      detail: trust.detail,
      action: 'verify_codex_gates',
      actionLabel: 'Повторить',
    };
  }
  return {
    id: 'codexTrust',
    label: 'Codex Trust',
    status: 'waiting',
    detail: trust && isStale(trust, status.checkedAt)
      ? 'Codex project trust evidence устарел. Повторите проверку Codex gates.'
      : 'Codex project trust ещё не подтверждён.',
    action: trust ? 'verify_codex_gates' : 'none',
    actionLabel: trust ? 'Повторить' : null,
  };
}

function codexGateNode(status: DesktopCodexGateStatus): DesktopCheckNode {
  if (status.ready) {
    return {
      id: 'codexGates',
      label: 'Codex Gates',
      status: 'active',
      detail: status.message,
      action: 'none',
      actionLabel: null,
    };
  }
  if (!hasCurrentPassed(status.evidence.verification.codexTrust, status.checkedAt)) {
    return {
      id: 'codexGates',
      label: 'Codex Gates',
      status: 'waiting',
      detail: 'Runtime hooks ждут подтверждения Codex Trust.',
      action: 'none',
      actionLabel: null,
    };
  }
  if (hasCodexRuntimeGateFailure(status)) {
    return {
      id: 'codexGates',
      label: 'Codex Gates',
      status: 'inactive',
      detail: status.message,
      action: 'verify_codex_gates',
      actionLabel: 'Повторить',
    };
  }
  if (!hasCodexVerifierAttempt(status) && isInitialCodexGateMessage(status.message)) {
    return {
      id: 'codexGates',
      label: 'Codex Gates',
      status: 'waiting',
      detail: 'Пульт проверяет Codex trust и настраивает gates автоматически.',
      action: 'none',
      actionLabel: null,
    };
  }
  if (hasCodexBaseVerification(status)) {
    return {
      id: 'codexGates',
      label: 'Codex Gates',
      status: 'waiting',
      detail: status.message,
      action: 'none',
      actionLabel: null,
    };
  }
  return {
    id: 'codexGates',
    label: 'Codex Gates',
    status: 'waiting',
    detail: status.message,
    action: 'none',
    actionLabel: null,
  };
}

function isInitialCodexGateMessage(message: string): boolean {
  return message === 'Codex CLI ещё не проверен.'
    || message === 'Codex project trust ещё не подтверждён.';
}

function hasCodexVerifierAttempt(status: DesktopCodexGateStatus): boolean {
  const evidence = status.evidence;
  return Boolean(
    evidence.commandRuns.codexHooks
    || evidence.verification.codexTrust
    || evidence.verification.codexRuntime
    || evidence.verification.desktopBootstrap
    || evidence.verification.hookPersistence
    || evidence.verification.runtimeContext
    || evidence.verification.smoke
    || evidence.verification.rollback,
  );
}

function hasCodexBaseVerification(status: DesktopCodexGateStatus): boolean {
  const evidence = status.evidence;
  return hasCurrentPassed(evidence.verification.codexTrust, status.checkedAt)
    && hasCurrentPassed(evidence.verification.codexRuntime, status.checkedAt)
    && hasCurrentPassed(evidence.commandRuns.codexHooks, status.checkedAt)
    && hasSmokeSatisfied(evidence.verification.smoke, status.checkedAt)
    && hasCurrentPassed(evidence.verification.rollback, status.checkedAt);
}

function hasCodexRuntimeGateFailure(status: DesktopCodexGateStatus): boolean {
  const evidence = status.evidence;
  return [
    evidence.verification.codexRuntime,
    evidence.commandRuns.codexHooks,
    evidence.verification.desktopBootstrap,
    evidence.verification.hookPersistence,
    evidence.verification.runtimeContext,
    evidence.verification.smoke,
    evidence.verification.rollback,
  ].some(item => item?.available === true && item.passed === false);
}

function hasPassed(value: DesktopCodexGateRunEvidence | undefined): boolean {
  return value?.available === true && value.passed === true;
}

function hasCurrentPassed(value: DesktopCodexGateRunEvidence | undefined, checkedAt: string): boolean {
  return hasPassed(value) && !isStale(value, checkedAt);
}

function hasSmokeSatisfied(value: DesktopCodexGateRunEvidence | undefined, checkedAt: string): boolean {
  if (hasCurrentPassed(value, checkedAt)) return true;
  return value?.available === false && !isStale(value, checkedAt);
}

function isStale(value: DesktopCodexGateRunEvidence | undefined, checkedAt: string): boolean {
  if (!value || value.checkedAt === undefined || value.staleAfterMs === undefined) return false;
  const valueTime = Date.parse(value.checkedAt);
  const referenceTime = Date.parse(checkedAt);
  if (!Number.isFinite(valueTime) || !Number.isFinite(referenceTime)) return true;
  return referenceTime - valueTime > value.staleAfterMs;
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
  if (service.running && service.health === 'healthy') return 'Watcher работает';
  if (!service.running) return 'Watcher остановлен';
  if (service.lastError) return `Watcher сообщает: ${service.lastError}`;
  return 'Watcher требует внимания';
}

function serviceReady(service: WatcherServiceStatus): boolean {
  return service.installed && service.running && service.health === 'healthy';
}

function serviceAction(service: WatcherServiceStatus): DesktopCheckNode['action'] {
  return service.installed ? 'start_service' : 'install_service';
}

function serviceActionLabel(service: WatcherServiceStatus): string {
  return service.installed ? 'Запустить watcher' : 'Установить службу';
}
