import type {
  DesktopCommandDescriptor,
  DesktopCommandId,
} from './desktop-command-contracts.js';
import type { DesktopCheckAction, SupportAgentAction, WatcherServiceAction } from './contracts.js';
import { DESKTOP_COMMAND_PROGRESS_TEXT } from './desktop-command-progress-text.js';

export const WATCHER_SERVICE_COMMAND_IDS: Record<WatcherServiceAction, DesktopCommandId> = {
  health: 'watcher.health',
  install: 'watcher.install',
  start: 'watcher.start',
  stop: 'watcher.stop',
  restart: 'watcher.restart',
  check_update: 'watcher.check_update',
  update: 'watcher.update',
};

export const SUPPORT_COMMAND_IDS: Record<SupportAgentAction, DesktopCommandId> = {
  collect_diagnostics: 'support.collect_diagnostics',
  repair_watcher_service: 'support.repair_watcher_service',
  restart_watcher: 'support.restart_watcher',
  update_watcher: 'support.update_watcher',
  verify_codex_gates: 'support.verify_codex_gates',
  refresh_mcp_config: 'support.refresh_mcp_config',
  mesh_status: 'support.mesh_status',
};

export const DESKTOP_CHECK_ACTION_COMMAND_IDS: Readonly<Partial<Record<DesktopCheckAction, DesktopCommandId>>> = {
  install_service: 'watcher.install',
  start_service: 'watcher.start',
  verify_codex_gates: 'codex.verify_gates',
  verify: 'diagnostics.collect',
};

export const DESKTOP_COMMAND_GLOBAL_ACTION_IDS: Readonly<Record<DesktopCommandId, string>> = {
  'watcher.health': 'desktop:watcher.health',
  'watcher.install': 'desktop:watcher.install',
  'watcher.start': 'desktop:watcher.start',
  'watcher.stop': 'desktop:watcher.stop',
  'watcher.restart': 'desktop:watcher.restart',
  'watcher.check_update': 'desktop:watcher.check_update',
  'watcher.update': 'desktop:watcher.update',
  'codex.verify_gates': 'desktop:codex.verify_gates',
  'mcp.refresh_config': 'desktop:mcp.refresh_config',
  'diagnostics.collect': 'desktop:diagnostics.collect',
  'support.collect_diagnostics': 'desktop:support.collect_diagnostics',
  'support.repair_watcher_service': 'desktop:support.repair_watcher_service',
  'support.restart_watcher': 'desktop:support.restart_watcher',
  'support.update_watcher': 'desktop:support.update_watcher',
  'support.verify_codex_gates': 'desktop:support.verify_codex_gates',
  'support.refresh_mcp_config': 'desktop:support.refresh_mcp_config',
  'support.mesh_status': 'desktop:support.mesh_status',
};

const SERVICE_HEALTH_STEPS = ['preflight', 'service_status', 'logs', 'diagnostics'] as const;
const SERVICE_INSTALL_STEPS = [
  'preflight',
  'runtime_download',
  'runtime_install',
  'service_install',
  'launcher_verify',
  'service_start',
  'health',
] as const;
const SERVICE_START_STEPS = ['preflight', 'service_start', 'health', 'diagnostics'] as const;
const SERVICE_STOP_STEPS = ['preflight', 'service_stop', 'status_verify', 'diagnostics'] as const;
const SERVICE_RESTART_STEPS = [
  'preflight',
  'service_stop',
  'service_start',
  'health',
  'diagnostics',
] as const;
const UPDATE_STEPS = [
  'preflight',
  'download',
  'verify',
  'install',
  'runtime_install',
  'restart',
  'health',
] as const;
const REMOTE_STEPS = ['claim', 'progress', 'execute', 'complete'] as const;

type SupportDescriptorSeed = readonly [
  DesktopCommandId,
  string,
  DesktopCommandDescriptor['risk'],
  boolean,
  number,
  readonly string[],
];

const SUPPORT_DESCRIPTOR_SEEDS: readonly SupportDescriptorSeed[] = [
  ['support.collect_diagnostics', 'Remote: собрать диагностику', 'low', false, 30_000, ['support.job', 'diagnostics.preview']],
  ['support.repair_watcher_service', 'Remote: починить watcher-службу', 'high', true, 240_000, ['support.job', 'service.receipt']],
  ['support.restart_watcher', 'Remote: перезапустить watcher', 'high', true, 240_000, ['support.job', 'service.receipt']],
  ['support.update_watcher', 'Remote: обновить watcher', 'high', true, 660_000, ['support.job', 'service.receipt', 'runtime-install.log']],
  ['support.verify_codex_gates', 'Remote: проверить Codex gates', 'medium', false, 180_000, ['support.job', 'codex.gates']],
  ['support.refresh_mcp_config', 'Remote: обновить MCP-конфиг', 'medium', true, 90_000, ['support.job', 'mcp.config', 'server.access']],
  ['support.mesh_status', 'Remote: проверить mesh', 'low', false, 10_000, ['support.job', 'mesh.status']],
];

export const DESKTOP_COMMAND_DESCRIPTORS: readonly DesktopCommandDescriptor[] = [
  desktopDescriptor({
    id: 'watcher.health',
    label: 'Проверить службу watcher',
    category: 'watcher_service',
    surface: 'electron',
    risk: 'low',
    destructive: false,
    timeoutMs: 30_000,
    requiredEvidence: ['service.status', 'watcher.logs'],
    progressSteps: SERVICE_HEALTH_STEPS,
  }),
  desktopDescriptor({
    id: 'watcher.install',
    label: 'Починить или установить watcher-службу',
    category: 'watcher_service',
    surface: 'electron',
    risk: 'high',
    destructive: true,
    timeoutMs: 180_000,
    requiredEvidence: ['service.metadata', 'launcher.ps1', 'winsw.wrapper.log'],
    progressSteps: SERVICE_INSTALL_STEPS,
  }),
  desktopDescriptor({
    id: 'watcher.start',
    label: 'Запустить watcher-службу',
    category: 'watcher_service',
    surface: 'electron',
    risk: 'medium',
    destructive: true,
    timeoutMs: 60_000,
    requiredEvidence: ['service.status', 'watcher.health', 'watcher.logs'],
    progressSteps: SERVICE_START_STEPS,
  }),
  desktopDescriptor({
    id: 'watcher.stop',
    label: 'Остановить watcher-службу',
    category: 'watcher_service',
    surface: 'electron',
    risk: 'medium',
    destructive: true,
    timeoutMs: 60_000,
    requiredEvidence: ['service.status', 'winsw.wrapper.log'],
    progressSteps: SERVICE_STOP_STEPS,
  }),
  desktopDescriptor({
    id: 'watcher.restart',
    label: 'Перезапустить watcher-службу',
    category: 'watcher_service',
    surface: 'electron',
    risk: 'high',
    destructive: true,
    timeoutMs: 60_000,
    requiredEvidence: ['service.status', 'watcher.health', 'watcher.logs'],
    progressSteps: SERVICE_RESTART_STEPS,
  }),
  desktopDescriptor({
    id: 'watcher.check_update',
    label: 'Проверить обновление пульта и watcher',
    category: 'updater',
    surface: 'electron',
    risk: 'low',
    destructive: false,
    timeoutMs: 10_000,
    requiredEvidence: ['desktop.version', 'watcher.version', 'github.release'],
    progressSteps: ['preflight', 'github_release', 'compare_versions'],
  }),
  desktopDescriptor({
    id: 'watcher.update',
    label: 'Обновить пульт и watcher',
    category: 'updater',
    surface: 'electron',
    risk: 'high',
    destructive: true,
    timeoutMs: 600_000,
    requiredEvidence: ['desktop.version', 'watcher.version', 'runtime-install.log', 'service.status'],
    progressSteps: UPDATE_STEPS,
  }),
  desktopDescriptor({
    id: 'codex.verify_gates',
    label: 'Проверить Codex gates',
    category: 'codex_gates',
    surface: 'electron',
    risk: 'medium',
    destructive: false,
    timeoutMs: 180_000,
    requiredEvidence: ['codex.version', 'codex.hooks', 'qualitygate.evidence', 'runtime-context.evidence'],
    progressSteps: ['preflight', 'hooks', 'quality_gates', 'runtime_context', 'diagnostics'],
  }),
  desktopDescriptor({
    id: 'mcp.refresh_config',
    label: 'Обновить MCP-конфиг',
    category: 'mcp_config',
    surface: 'electron',
    risk: 'medium',
    destructive: true,
    timeoutMs: 90_000,
    requiredEvidence: ['mcp.config', 'project.profile', 'server.access'],
    progressSteps: ['preflight', 'write_config', 'verify_access', 'diagnostics'],
  }),
  desktopDescriptor({
    id: 'diagnostics.collect',
    label: 'Собрать диагностику',
    category: 'diagnostics',
    surface: 'electron',
    risk: 'low',
    destructive: false,
    timeoutMs: 30_000,
    requiredEvidence: ['service.status', 'logs.transport', 'policy.gates'],
    progressSteps: ['preflight', 'collect', 'redact', 'diagnostics'],
  }),
  ...supportCommandDescriptors(),
];

const DESKTOP_COMMAND_DESCRIPTOR_MAP = new Map(
  DESKTOP_COMMAND_DESCRIPTORS.map(descriptor => [descriptor.id, descriptor] as const),
);

export function watcherServiceCommandId(action: WatcherServiceAction): DesktopCommandId {
  return WATCHER_SERVICE_COMMAND_IDS[action];
}

export function supportCommandId(action: SupportAgentAction): DesktopCommandId {
  return SUPPORT_COMMAND_IDS[action];
}

export function desktopCheckActionCommandId(action: DesktopCheckAction): DesktopCommandId | null {
  return DESKTOP_CHECK_ACTION_COMMAND_IDS[action] ?? null;
}

export function descriptorForCommand(commandId: DesktopCommandId): DesktopCommandDescriptor {
  const descriptor = DESKTOP_COMMAND_DESCRIPTOR_MAP.get(commandId);
  if (!descriptor) throw new Error(`Unknown desktop command descriptor: ${commandId}`);
  return descriptor;
}

export function allDesktopCommandDescriptors(): readonly DesktopCommandDescriptor[] {
  return DESKTOP_COMMAND_DESCRIPTORS;
}

function supportCommandDescriptors(): readonly DesktopCommandDescriptor[] {
  return SUPPORT_DESCRIPTOR_SEEDS.map(([id, label, risk, destructive, timeoutMs, requiredEvidence]) => desktopDescriptor({
    id,
    label,
    category: 'remote_support',
    surface: 'remote',
    risk,
    destructive,
    timeoutMs,
    requiredEvidence,
    progressSteps: REMOTE_STEPS,
  }));
}

type DesktopCommandDescriptorSeed = Omit<DesktopCommandDescriptor, 'globalActionId' | 'progressText'>;

function desktopDescriptor(seed: DesktopCommandDescriptorSeed): DesktopCommandDescriptor {
  return {
    ...seed,
    globalActionId: DESKTOP_COMMAND_GLOBAL_ACTION_IDS[seed.id],
    progressText: DESKTOP_COMMAND_PROGRESS_TEXT[seed.id],
  };
}
