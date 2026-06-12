import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SavedProjectProfile, WatcherServiceAction, WatcherServiceStatus } from './contracts.js';

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
  if (!source.includes('NPM_CONFIG_CACHE') || !source.includes('npm-cache')) {
    reasons.push('launcher_missing_service_npm_cache');
  }
  if (!source.includes('NO_UPDATE_NOTIFIER')) {
    reasons.push('launcher_missing_update_notifier_guard');
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
