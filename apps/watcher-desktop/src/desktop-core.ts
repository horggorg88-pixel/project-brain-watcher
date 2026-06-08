import { join } from 'node:path';
import type {
  DiagnosticsPreview,
  McpDiffPreview,
  SavedProjectProfile,
  WatcherPolicyGate,
} from './contracts.js';
import {
  applyMcpConfigToProfile,
  defaultProfile,
  readProfiles,
  type DesktopCorePaths,
} from './desktop-profile-store.js';
import { discoverMcpConfig } from './desktop-config-discovery.js';
import { readDesktopServiceSecretState } from './desktop-service-secret.js';
import { readServiceStatus } from './desktop-service-status.js';
export { readProfiles, saveProfile, type DesktopCorePaths } from './desktop-profile-store.js';
export { readServiceStatus } from './desktop-service-status.js';
export { runServiceAction } from './desktop-service-runner.js';

export function listDesktopProjectProfiles(paths: DesktopCorePaths): readonly SavedProjectProfile[] {
  const profiles = readProfiles(paths);
  const config = discoverMcpConfig(paths);
  if (profiles.length > 0) {
    return profiles.map(profile => applyMcpConfigToProfile(profile, config) ?? profile);
  }
  const fallback = applyMcpConfigToProfile(defaultProfile(paths), config);
  return fallback ? [fallback] : [];
}

export function previewMcpDiff(paths: DesktopCorePaths, client: McpDiffPreview['client']): McpDiffPreview {
  const configPath = client === 'codex'
    ? join(paths.homePath, '.codex', 'config.toml')
    : join(paths.homePath, '.config', `${client}-mcp.json`);
  return {
    client,
    configPath,
    backupRequired: true,
    changes: ['Добавить endpoint проекта MCP', 'Использовать токен из переменной среды или хранилища ОС', 'Сохранить резервную копию перед изменением'],
  };
}

export function previewDiagnostics(paths: DesktopCorePaths): DiagnosticsPreview {
  const profiles = readProfiles(paths);
  const config = discoverMcpConfig(paths);
  const profile = applyMcpConfigToProfile(profiles[0] ?? defaultProfile(paths), config);
  const secret = readDesktopServiceSecretState(profile);
  const service = readServiceStatus(paths);
  const checks = diagnosticChecks({
    profileConfigured: profile !== null,
    configFound: config.found,
    secretConfigured: secret.configured,
    secretAclRestricted: secret.acl.restricted,
    serviceHealthy: service.running && service.health === 'healthy',
  });
  const readiness = checks.some(check => check.decision === 'deny')
    ? 'deny'
    : checks.some(check => check.decision === 'prompt') ? 'prompt' : 'allow';
  return {
    blocked: readiness === 'deny',
    requiresSecretConfirmation: !secret.configured,
    readiness,
    findings: checks.flatMap(check => check.reasons),
    included: [
      `Профили: ${profiles.length > 0 ? profiles.length : profile ? 'Codex fallback' : 0}`,
      `MCP config: ${config.found ? config.source : 'не найден'}`,
      `Secret file: ${secret.configured ? 'есть' : 'нет'}`,
      `Secret ACL: ${secret.acl.restricted ? 'ограничен' : `не подтверждён (${secret.acl.reason ?? 'unknown'})`}`,
      `Secret repair: ${secret.acl.repairHint ?? 'не требуется'}`,
      `Secret fingerprint: ${secret.actualFingerprint ?? 'нет'}`,
      `Служба: ${service.health}`,
    ],
    secretWarnings: ['Bearer-токен', 'MCP_BEARER_TOKEN', 'локальные пути проектов'],
    checks,
  };
}

function diagnosticChecks(input: {
  readonly profileConfigured: boolean;
  readonly configFound: boolean;
  readonly secretConfigured: boolean;
  readonly secretAclRestricted: boolean;
  readonly serviceHealthy: boolean;
}): WatcherPolicyGate[] {
  return [
    gate(input.profileConfigured, 'deny', 'Профиль проекта найден', 'Профиль проекта не импортирован'),
    gate(input.configFound, 'deny', 'MCP config найден', 'MCP config не найден'),
    gate(input.secretConfigured, 'prompt', 'Secret-файл службы найден', 'Secret-файл службы не создан'),
    gate(input.secretAclRestricted, 'prompt', 'ACL secret-файла ограничен', 'ACL secret-файла не подтверждён'),
    gate(input.serviceHealthy, 'prompt', 'Watcher-служба работает', 'Watcher-служба не в healthy состоянии'),
  ];
}

function gate(ok: boolean, failedDecision: WatcherPolicyGate['decision'], passReason: string, failReason: string): WatcherPolicyGate {
  return ok
    ? { decision: 'allow', risk: 'low', reasons: [passReason] }
    : { decision: failedDecision, risk: failedDecision === 'deny' ? 'high' : 'medium', reasons: [failReason] };
}
