import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SavedProjectProfile, WatcherServiceAction, WatcherServiceStatus } from './contracts.js';
import { serviceName } from './desktop-profile-store.js';

export interface ServiceCommandResult {
  readonly exitCode: number;
  readonly output: string;
}

export interface ServiceLauncherRepairState {
  readonly launcherPath: string;
  readonly requiresRepair: boolean;
  readonly reasons: readonly string[];
}

export function serviceLauncherPath(profile: SavedProjectProfile): string {
  return join(profile.root, '.brain', 'service', 'launch-watcher.ps1');
}

export function readServiceLauncherRepairState(profile: SavedProjectProfile): ServiceLauncherRepairState {
  const launcherPath = serviceLauncherPath(profile);
  if (!existsSync(launcherPath)) {
    return { launcherPath, requiresRepair: true, reasons: ['launcher_missing'] };
  }
  const source = readFileSync(launcherPath, 'utf-8');
  const reasons: string[] = [];
  const watcherEntry = serviceRuntimeWatcherEntry(profile);
  if (!source.includes('NPM_CONFIG_CACHE') || !source.includes('npm-cache')) {
    reasons.push('launcher_missing_service_npm_cache');
  }
  if (!source.includes('NO_UPDATE_NOTIFIER')) {
    reasons.push('launcher_missing_update_notifier_guard');
  }
  if (usesNpxRunner(source)) {
    reasons.push('launcher_uses_npx_runner');
  }
  if (!containsNormalizedPath(source, watcherEntry)) {
    reasons.push('launcher_missing_node_runtime_entry');
  } else if (!existsSync(watcherEntry)) {
    reasons.push('service_runtime_missing');
  }
  const xmlPath = serviceXmlPath(profile);
  if (existsSync(xmlPath) && usesNpxRunner(readFileSync(xmlPath, 'utf-8'))) {
    reasons.push('service_xml_uses_npx_runner');
  }
  return { launcherPath, requiresRepair: reasons.length > 0, reasons };
}

export function serviceInstallAlreadyExists(output: string): boolean {
  return /already exists|служба уже существует/i.test(output);
}

export function serviceRefreshUnsupported(output: string): boolean {
  return /unknown command:\s*refresh/i.test(output);
}

export function normalizeServiceInstallResult(exitCode: number, output: string): ServiceCommandResult {
  if (exitCode === 0 || !serviceInstallAlreadyExists(output)) return { exitCode, output };
  return {
    exitCode: 0,
    output: [
      output.trim(),
      'service repair: служба уже установлена, launcher/XML обновлены, можно продолжать запуск или перезапуск.',
    ].filter(Boolean).join('\n'),
  };
}

export function normalizeServiceRefreshResult(exitCode: number, output: string): ServiceCommandResult {
  if (exitCode === 0 || !serviceRefreshUnsupported(output)) return { exitCode, output };
  return {
    exitCode: 0,
    output: [
      output.trim(),
      'service repair: WinSW refresh недоступен в старый WinSW, launcher/XML обновлены, продолжаю запуск через start/restart.',
    ].filter(Boolean).join('\n'),
  };
}

export function shouldRepairServiceLauncherBeforeAction(
  action: WatcherServiceAction,
  status: WatcherServiceStatus,
  repairState: Pick<ServiceLauncherRepairState, 'requiresRepair'>,
): boolean {
  if (!status.installed || !repairState.requiresRepair) return false;
  return action === 'install' || action === 'start' || action === 'restart' || action === 'update';
}

function serviceRuntimeWatcherEntry(profile: SavedProjectProfile): string {
  return join(profile.root, '.brain', 'service', 'runtime', 'node_modules', 'project-brain-watcher', 'bin', 'watcher.js');
}

function serviceXmlPath(profile: SavedProjectProfile): string {
  return join(profile.root, '.brain', 'service', `${serviceName(profile.id)}.xml`);
}

function usesNpxRunner(source: string): boolean {
  return /(^|["'\s>\\\/])npx(?:\.cmd)?(["'\s<\\\/]|$)/i.test(source)
    || /github:horggorg88-pixel\/project-brain-watcher#v\d+\.\d+\.\d+/i.test(source);
}

function containsNormalizedPath(source: string, expectedPath: string): boolean {
  return normalizePathText(source).includes(normalizePathText(expectedPath));
}

function normalizePathText(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}
