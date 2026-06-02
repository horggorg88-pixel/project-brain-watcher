import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  SavedProjectProfile,
  WatcherPolicyGate,
  WatcherServiceActionRequest,
  WatcherServiceActionResult,
} from './contracts.js';
import { defaultProfile, readProfiles, type DesktopCorePaths } from './desktop-profile-store.js';
import { readDesktopServiceSecret } from './desktop-service-secret.js';
import { verifyProjectServerAccess } from './desktop-server-access.js';
import { readServiceStatus } from './desktop-service-status.js';

const WATCHER_PACKAGE = 'github:horggorg88-pixel/project-brain-watcher#v1.4.4';

export async function runServiceAction(
  paths: DesktopCorePaths,
  request: WatcherServiceActionRequest,
): Promise<WatcherServiceActionResult> {
  const profile = readProfiles(paths).find(item => item.id === request.projectId) ?? defaultProfile(paths);
  if (request.action === 'health') return healthResult(paths);
  const token = profile ? readDesktopServiceSecret(profile) ?? process.env[profile.tokenEnv] ?? null : null;
  const policy = servicePolicy(request, profile, token);
  if (policy.decision !== 'allow') {
    return { executed: false, policy, status: readServiceStatus(paths), exitCode: null, output: policy.reasons.join('\n') };
  }
  if (!profile) {
    return { executed: false, policy, status: readServiceStatus(paths), exitCode: null, output: 'Проект не найден' };
  }
  if (request.action !== 'stop') {
    const serverAccess = await verifyProjectServerAccess(profile, token);
    if (!serverAccess.verified) {
      const denied: WatcherPolicyGate = { decision: 'deny', risk: 'high', reasons: [serverAccess.message] };
      return { executed: false, policy: denied, status: readServiceStatus(paths), exitCode: null, output: serverAccess.message };
    }
  }
  const result = await spawnWatcher(defaultNpxExecutable(), buildServiceArgs(request.action, profile), profile.root, token
    ? { [profile.tokenEnv]: token }
    : {});
  return {
    executed: true,
    policy,
    status: readServiceStatus(paths),
    exitCode: result.exitCode,
    output: result.output,
  };
}

function healthResult(paths: DesktopCorePaths): WatcherServiceActionResult {
  const status = readServiceStatus(paths);
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
  if (request.action !== 'stop' && !token && !process.env[profile.tokenEnv]) {
    return { decision: 'deny', risk: 'high', reasons: [`Bearer для ${profile.tokenEnv} не найден. Импортируйте конфиг из личного кабинета.`] };
  }
  return { decision: 'allow', risk: request.action === 'install' ? 'high' : 'medium', reasons: ['Действие подтверждено пользователем'] };
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

function spawnWatcher(
  command: string,
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>>,
): Promise<{ readonly exitCode: number; readonly output: string }> {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, windowsHide: true });
    const chunks: string[] = [];
    const timer = setTimeout(() => child.kill(), 60_000);
    child.stdout.on('data', chunk => chunks.push(String(chunk)));
    child.stderr.on('data', chunk => chunks.push(String(chunk)));
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

function defaultNpxExecutable(): string {
  if (process.platform !== 'win32') return 'npx';
  const localNpx = join(dirname(process.execPath), 'npx.cmd');
  return existsSync(localNpx) ? localNpx : 'npx.cmd';
}

function actionLabel(action: WatcherServiceActionRequest['action']): string {
  const labels = { health: 'Проверить', install: 'Установить службу', start: 'Запустить', stop: 'Остановить', restart: 'Перезапустить' };
  return labels[action];
}
