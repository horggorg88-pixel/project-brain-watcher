import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  SavedProjectProfile,
  WatcherPolicyGate,
  WatcherServiceActionRequest,
  WatcherServiceActionResult,
  WatcherServiceStatus,
} from './contracts.js';
import { discoverMcpConfig } from './desktop-config-discovery.js';
import { applyMcpConfigToProfile, type DesktopCorePaths } from './desktop-profile-store.js';
import { readDesktopServiceToken, stageDesktopServiceSecret, type DesktopServiceSecretState } from './desktop-service-secret.js';
import {
  fetchReleaseVersionCheck,
  formatReleaseVersionCheck,
  readLocalDesktopVersion,
  watcherPackageVersion,
} from './desktop-release-update.js';
import { verifyProjectServerAccess } from './desktop-server-access.js';
import { readServiceStatus, resolveServiceProfile } from './desktop-service-status.js';

const WATCHER_PACKAGE = 'github:horggorg88-pixel/project-brain-watcher#v1.4.16';
const SERVICE_ACTION_SETTLE_TIMEOUT_MS = 30_000;
const SERVICE_ACTION_SETTLE_POLL_MS = 750;

export async function runServiceAction(
  paths: DesktopCorePaths,
  request: WatcherServiceActionRequest,
): Promise<WatcherServiceActionResult> {
  const profile = applyMcpConfigToProfile(
    resolveServiceProfile(paths, request.projectId),
    discoverMcpConfig(paths),
  );
  if (request.action === 'health') return healthResult(paths, request.projectId);
  const token = profile ? readDesktopServiceToken(profile) : null;
  const status = readServiceStatus(paths, request.projectId);
  if (request.action === 'start' && status.running) {
    return {
      executed: false,
      policy: { decision: 'allow', risk: 'low', reasons: ['Watcher уже работает'] },
      status,
      exitCode: 0,
      output: `Watcher уже работает, pid=${status.pid ?? 'нет'}. Повторный запуск не требуется.`,
    };
  }
  const policy = servicePolicy(request, profile, token);
  if (policy.decision !== 'allow') {
    return { executed: false, policy, status: readServiceStatus(paths, request.projectId), exitCode: null, output: policy.reasons.join('\n') };
  }
  if (!profile) {
    return { executed: false, policy, status: readServiceStatus(paths, request.projectId), exitCode: null, output: 'Проект не найден' };
  }
  if (request.action !== 'stop') {
    const serverAccess = await verifyProjectServerAccess(profile, token);
    if (!serverAccess.verified) {
      const denied: WatcherPolicyGate = { decision: 'deny', risk: 'high', reasons: [serverAccess.message] };
      return { executed: false, policy: denied, status: readServiceStatus(paths, profile.id), exitCode: null, output: serverAccess.message };
    }
    prepareServiceSecretForLaunch(profile, token);
  }
  if (request.action === 'update') return runUpdateAction(paths, profile, token, policy);
  const result = await spawnWatcher(defaultNpxExecutable(), buildServiceArgs(request.action, profile), profile.root, token
    ? { [profile.tokenEnv]: token }
    : {});
  const finalStatus = await waitForServiceActionStatus(paths, request.action, profile.id);
  return {
    executed: true,
    policy,
    status: finalStatus,
    exitCode: result.exitCode,
    output: result.output,
  };
}

export function prepareServiceSecretForLaunch(
  profile: SavedProjectProfile,
  token: string | null,
): DesktopServiceSecretState {
  if (!token) throw new Error(`Bearer для ${profile.tokenEnv} не найден`);
  return stageDesktopServiceSecret(profile, token);
}

export function isServiceActionSettled(
  action: WatcherServiceActionRequest['action'],
  status: WatcherServiceStatus,
): boolean {
  if (/PENDING/i.test(status.lastError ?? '')) return false;
  if (action === 'start' || action === 'restart') return status.running && status.health === 'healthy';
  if (action === 'stop') return !status.running;
  return true;
}

async function runUpdateAction(
  paths: DesktopCorePaths,
  profile: SavedProjectProfile,
  token: string | null,
  policy: WatcherPolicyGate,
): Promise<WatcherServiceActionResult> {
  const versionReport = await updateVersionReport();
  const env = token ? { [profile.tokenEnv]: token } : {};
  const command = defaultNpxExecutable();
  const desktop = await spawnWatcher(command, buildDesktopUpdateArgs(), profile.root, env);
  if (desktop.exitCode !== 0) return updateResult(paths, profile.id, policy, desktop.exitCode, versionReport, ['Пульт не обновлён', desktop.output]);
  const install = await spawnWatcher(command, buildServiceInstallArgs(profile), profile.root, env);
  if (install.exitCode !== 0) return updateResult(paths, profile.id, policy, install.exitCode, versionReport, ['Пульт обновлён', install.output]);
  const restart = await spawnWatcher(command, buildServiceRestartArgs(profile), profile.root, env);
  const status = await waitForServiceActionStatus(paths, 'restart', profile.id);
  return {
    executed: true,
    policy,
    status,
    exitCode: restart.exitCode,
    output: [
      versionReport,
      'Пульт: команда обновления выполнена.',
      compactOutput(desktop.output),
      'Watcher: служба переустановлена через текущий release.',
      compactOutput(install.output),
      'Watcher: служба перезапущена.',
      compactOutput(restart.output),
    ].filter(Boolean).join('\n\n'),
  };
}

function updateResult(
  paths: DesktopCorePaths,
  projectId: string,
  policy: WatcherPolicyGate,
  exitCode: number,
  versionReport: string,
  output: readonly string[],
): WatcherServiceActionResult {
  return {
    executed: true,
    policy,
    status: readServiceStatus(paths, projectId),
    exitCode,
    output: [versionReport, ...output.map(compactOutput)].filter(Boolean).join('\n\n'),
  };
}

async function updateVersionReport(): Promise<string> {
  try {
    return formatReleaseVersionCheck(
      await fetchReleaseVersionCheck(readLocalDesktopVersion(), watcherPackageVersion(WATCHER_PACKAGE)),
    );
  } catch (error) {
    return [
      `Проверка версий не завершена: ${errorMessage(error)}`,
      `Пульт: ${safeLocalDesktopVersion()}`,
      `Watcher: ${watcherPackageVersion(WATCHER_PACKAGE)}`,
      'Принудительное обновление продолжается.',
    ].join('\n');
  }
}

function healthResult(paths: DesktopCorePaths, projectId: string): WatcherServiceActionResult {
  const status = readServiceStatus(paths, projectId);
  const healthy = status.running && status.health === 'healthy';
  return {
    executed: false,
    policy: {
      decision: 'allow',
      risk: healthy ? 'low' : 'medium',
      reasons: [healthy ? 'Watcher работает' : 'Watcher требует внимания'],
    },
    status,
    exitCode: healthy ? 0 : 1,
    output: healthy
      ? `Подключение активно. Watcher работает, pid=${status.pid ?? 'нет'}.`
      : `Проверка не пройдена: ${status.lastError ?? 'Watcher не работает'}. Служба не запускалась и не перезапускалась.`,
  };
}

function servicePolicy(
  request: WatcherServiceActionRequest,
  profile: SavedProjectProfile | null,
  token: string | null,
): WatcherPolicyGate {
  if (!profile) return { decision: 'deny', risk: 'high', reasons: ['Проект не найден'] };
  if (!existsSync(profile.root)) return { decision: 'deny', risk: 'high', reasons: ['Путь проекта не существует'] };
  if (request.action !== 'stop' && !profile.serverUrl) {
    return { decision: 'deny', risk: 'high', reasons: ['MCP сервер не задан в профиле проекта'] };
  }
  if (!request.confirmed) {
    return { decision: 'prompt', risk: 'high', reasons: [`Подтвердите действие: ${actionLabel(request.action)}`] };
  }
  if (request.action !== 'stop' && !token) {
    return { decision: 'deny', risk: 'high', reasons: [`Bearer для ${profile.tokenEnv} не найден. Войдите в пульт и выберите папку проекта повторно.`] };
  }
  return { decision: 'allow', risk: request.action === 'install' || request.action === 'update' ? 'high' : 'medium', reasons: ['Действие подтверждено пользователем'] };
}

function buildServiceArgs(action: WatcherServiceActionRequest['action'], profile: SavedProjectProfile): string[] {
  return [
    '--yes',
    WATCHER_PACKAGE,
    'service',
    action,
    '--path',
    profile.root,
    '--server',
    profile.serverUrl,
    '--token-env',
    profile.tokenEnv,
    '--project',
    profile.id,
  ];
}

function buildDesktopUpdateArgs(): string[] {
  return ['--yes', WATCHER_PACKAGE, 'desktop', 'update'];
}

function buildServiceInstallArgs(profile: SavedProjectProfile): string[] {
  return ['--yes', WATCHER_PACKAGE, 'service', 'install', ...serviceArgs(profile)];
}

function buildServiceRestartArgs(profile: SavedProjectProfile): string[] {
  return ['--yes', WATCHER_PACKAGE, 'service', 'restart', ...serviceArgs(profile)];
}

function serviceArgs(profile: SavedProjectProfile): string[] {
  return [
    '--path',
    profile.root,
    '--server',
    profile.serverUrl,
    '--token-env',
    profile.tokenEnv,
    '--project',
    profile.id,
  ];
}

function spawnWatcher(
  command: string,
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>>,
): Promise<{ readonly exitCode: number; readonly output: string }> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    const invocation = spawnInvocation(command, args);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(invocation.command, invocation.args, { cwd, env: { ...process.env, ...env }, windowsHide: true });
    } catch (error) {
      resolve({ exitCode: 1, output: error instanceof Error ? error.message : String(error) });
      return;
    }
    const timer = setTimeout(() => child.kill(), 60_000);
    child.stdout?.on('data', chunk => chunks.push(String(chunk)));
    child.stderr?.on('data', chunk => chunks.push(String(chunk)));
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, output: chunks.join('').trim() });
    });
    child.on('error', error => {
      clearTimeout(timer);
      resolve({ exitCode: 1, output: error.message });
    });
  });
}

async function waitForServiceActionStatus(
  paths: DesktopCorePaths,
  action: WatcherServiceActionRequest['action'],
  projectId: string,
): Promise<WatcherServiceStatus> {
  const deadline = Date.now() + SERVICE_ACTION_SETTLE_TIMEOUT_MS;
  let status = readServiceStatus(paths, projectId);
  while (!isServiceActionSettled(action, status) && Date.now() < deadline) {
    await delay(SERVICE_ACTION_SETTLE_POLL_MS);
    status = readServiceStatus(paths, projectId);
  }
  return status;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function spawnInvocation(command: string, args: readonly string[]): { readonly command: string; readonly args: readonly string[] } {
  if (process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')) {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', command, ...args] };
  }
  return { command, args };
}

function defaultNpxExecutable(): string {
  if (process.platform !== 'win32') return 'npx';
  const localNpx = join(dirname(process.execPath), 'npx.cmd');
  return existsSync(localNpx) ? localNpx : 'npx.cmd';
}

function actionLabel(action: WatcherServiceActionRequest['action']): string {
  const labels = { health: 'Проверить', install: 'Установить службу', start: 'Запустить', stop: 'Остановить', restart: 'Перезапустить', update: 'Обновить пульт и watcher' };
  return labels[action];
}

function compactOutput(value: string): string {
  return value.trim();
}

function safeLocalDesktopVersion(): string {
  try {
    return readLocalDesktopVersion();
  } catch {
    return 'не определена';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
