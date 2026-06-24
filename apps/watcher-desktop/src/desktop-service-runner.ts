import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  SavedProjectProfile,
  WatcherCommandStatus,
  WatcherPolicyGate,
  WatcherServiceActionRequest,
  WatcherServiceActionResult,
  WatcherServiceStatus,
} from './contracts.js';
import { discoverMcpConfig } from './desktop-config-discovery.js';
import { applyMcpConfigToProfile, type DesktopCorePaths } from './desktop-profile-store.js';
import { readDesktopEnvServiceToken, readDesktopServiceToken, stageDesktopServiceSecret, type DesktopServiceSecretState } from './desktop-service-secret.js';
import {
  fetchReleaseVersionCheck,
  formatReleaseVersionCheck,
  readLocalDesktopVersion,
  watcherPackageVersion,
} from './desktop-release-update.js';
import { type DesktopServerAccessVerification, verifyProjectServerAccess } from './desktop-server-access.js';
import {
  buildServiceImagePathRepairArgs,
  normalizeServiceImagePathRepairResult,
  normalizeServiceInstallResult,
  normalizeServiceRefreshResult,
  readServiceLauncherRepairState,
  serviceImagePathRepairRequired,
  shouldRepairServiceLauncherBeforeAction,
} from './desktop-service-repair.js';
import { readServiceStatus, resolveServiceProfile } from './desktop-service-status.js';

const WATCHER_PACKAGE = 'https://github.com/horggorg88-pixel/project-brain-watcher/releases/download/v1.4.90/project-brain-watcher-1.4.90.tgz';
const SERVICE_ACTION_SETTLE_TIMEOUT_MS = 30_000;
const SERVICE_ACTION_SETTLE_POLL_MS = 750;
const WATCHER_COMMAND_TIMEOUT_MS = 60_000;
const SERVICE_INSTALL_TIMEOUT_MS = 180_000;
const SERVICE_METADATA_REPAIR_TIMEOUT_MS = 30_000;
const DESKTOP_UPDATE_TIMEOUT_MS = 10 * 60_000;

export interface SpawnWatcherOptions {
  readonly timeoutMs?: number;
  readonly timeoutLabel?: string;
}

export interface SpawnWatcherResult {
  readonly exitCode: number;
  readonly output: string;
  readonly commandStatus: WatcherCommandStatus;
}

export async function runServiceAction(
  paths: DesktopCorePaths,
  request: WatcherServiceActionRequest,
): Promise<WatcherServiceActionResult> {
  const profile = applyMcpConfigToProfile(
    resolveServiceProfile(paths, request.projectId),
    discoverMcpConfig(paths),
  );
  if (request.action === 'health') return healthResult(paths, request.projectId);
  if (request.action === 'check_update') return checkUpdateResult(paths, request.projectId);
  let token = profile ? readDesktopServiceToken(profile) : null;
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
    if (request.action === 'update') {
      prepareServiceSecretForLaunch(profile, token);
    } else {
      const verifiedToken = await resolveVerifiedServiceActionToken(profile, token);
      token = verifiedToken.token;
      const serverAccess = verifiedToken.serverAccess;
      if (!serverAccess.verified) {
        const denied: WatcherPolicyGate = { decision: 'deny', risk: 'high', reasons: [serverAccess.message] };
        return { executed: false, policy: denied, status: readServiceStatus(paths, profile.id), exitCode: null, output: serverAccess.message };
      }
      prepareServiceSecretForLaunch(profile, token);
    }
  }
  const env = token ? { [profile.tokenEnv]: token } : {};
  const command = defaultNpxExecutable();
  if (request.action === 'update') return runUpdateAction(paths, profile, token, policy);
  const repair = await repairServiceLauncherIfNeeded(profile, status, request.action, command, env);
  if (repair && repair.exitCode !== 0) {
    return {
      executed: true,
      policy,
      status: readServiceStatus(paths, profile.id),
      exitCode: repair.exitCode,
      output: repair.output,
      commandStatus: repair.commandStatus,
    };
  }
  if (request.action === 'install' && repair) {
    return {
      executed: true,
      policy,
      status: readServiceStatus(paths, profile.id),
      exitCode: repair.exitCode,
      output: repair.output,
      commandStatus: repair.commandStatus,
    };
  }
  const rawResult = await spawnWatcher(command, buildServiceActionArgs(request.action, profile), profile.root, env, serviceSpawnOptions(request.action));
  const result = request.action === 'install'
    ? normalizeServiceInstallResult(rawResult.exitCode, rawResult.output)
    : rawResult;
  const finalStatus = await waitForServiceActionStatus(paths, request.action, profile.id);
  const commandOutput = [repair?.output, result.output].filter(Boolean).join('\n\n');
  const settlement = summarizeServiceActionSettlement(request.action, result.exitCode, commandOutput, finalStatus);
  return {
    executed: true,
    policy,
    status: finalStatus,
    exitCode: settlement.exitCode,
    output: settlement.output,
    commandStatus: rawResult.commandStatus,
  };
}

async function repairServiceLauncherIfNeeded(
  profile: SavedProjectProfile,
  status: WatcherServiceStatus,
  action: WatcherServiceActionRequest['action'],
  command: string,
  env: Readonly<Record<string, string>>,
): Promise<SpawnWatcherResult | null> {
  const repairState = readServiceLauncherRepairState(profile);
  if (!shouldRepairServiceLauncherBeforeAction(action, status, repairState)) return null;
  const install = await spawnWatcher(command, buildServiceInstallArgs(profile), profile.root, env, serviceSpawnOptions('install'));
  const normalized = normalizeServiceInstallResult(install.exitCode, install.output);
  const output = [
    `service repair: launcher устарел (${repairState.reasons.join(', ')})`,
    install.exitCode === 0 ? null : 'service repair: install already exists',
    normalized.output,
  ];
  if (normalized.exitCode !== 0) {
    return { exitCode: normalized.exitCode, output: output.filter(Boolean).join('\n'), commandStatus: install.commandStatus };
  }
  if (install.exitCode !== 0) {
    const refreshRaw = await refreshServiceMetadata(profile, command, env);
    const refresh = normalizeServiceRefreshResult(refreshRaw.exitCode, refreshRaw.output);
    output.push(refreshRaw.exitCode === 0
      ? 'service repair: refresh выполнен'
      : refresh.exitCode === 0
        ? 'service repair: refresh недоступен, продолжаю через start/restart'
        : 'service repair: refresh не выполнен');
    output.push(refresh.output);
    if (refresh.exitCode !== 0) {
      return { exitCode: refresh.exitCode, output: output.filter(Boolean).join('\n'), commandStatus: refreshRaw.commandStatus };
    }
    if (refreshRaw.exitCode !== 0 && serviceImagePathRepairRequired(status)) {
      const imagePathRaw = await repairServiceImagePath(profile);
      const imagePath = normalizeServiceImagePathRepairResult(imagePathRaw.exitCode, imagePathRaw.output);
      output.push(imagePathRaw.exitCode === 0
        ? 'service repair: SCM binPath обновлён'
        : 'service repair: SCM binPath не обновлён');
      output.push(imagePath.output);
      return { exitCode: imagePath.exitCode, output: output.filter(Boolean).join('\n'), commandStatus: imagePathRaw.commandStatus };
    }
    if (refreshRaw.exitCode !== 0) {
      output.push('service repair: SCM binPath уже указывает на текущий проект, admin repair не нужен');
    }
    return { exitCode: 0, output: output.filter(Boolean).join('\n'), commandStatus: refreshRaw.commandStatus };
  }
  return {
    exitCode: 0,
    output: output.filter(Boolean).join('\n'),
    commandStatus: install.commandStatus,
  };
}

async function refreshServiceMetadata(
  profile: SavedProjectProfile,
  command: string,
  env: Readonly<Record<string, string>>,
): Promise<SpawnWatcherResult> {
  return spawnWatcher(command, buildServiceRefreshArgs(profile), profile.root, env, {
    timeoutMs: SERVICE_INSTALL_TIMEOUT_MS,
    timeoutLabel: 'service refresh',
  });
}

async function repairServiceImagePath(
  profile: SavedProjectProfile,
): Promise<SpawnWatcherResult> {
  return spawnWatcher('sc.exe', buildServiceImagePathRepairArgs(profile), profile.root, {}, {
    timeoutMs: SERVICE_METADATA_REPAIR_TIMEOUT_MS,
    timeoutLabel: 'service image path repair',
  });
}

export function prepareServiceSecretForLaunch(
  profile: SavedProjectProfile,
  token: string | null,
): DesktopServiceSecretState {
  if (!token) throw new Error(`Bearer для ${profile.tokenEnv} не найден`);
  return stageDesktopServiceSecret(profile, token);
}

export interface VerifiedServiceActionToken {
  readonly token: string | null;
  readonly serverAccess: DesktopServerAccessVerification;
}

export async function resolveVerifiedServiceActionToken(
  profile: SavedProjectProfile,
  token: string | null,
): Promise<VerifiedServiceActionToken> {
  const serverAccess = await verifyProjectServerAccess(profile, token);
  if (serverAccess.verified) return { token, serverAccess };
  const envToken = readDesktopEnvServiceToken(profile);
  if (!envToken || envToken === token) return { token, serverAccess };
  const envAccess = await verifyProjectServerAccess(profile, envToken);
  if (!envAccess.verified) return { token, serverAccess };
  stageDesktopServiceSecret(profile, envToken);
  return { token: envToken, serverAccess: envAccess };
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

export function summarizeServiceActionSettlement(
  action: WatcherServiceActionRequest['action'],
  commandExitCode: number,
  commandOutput: string,
  status: WatcherServiceStatus,
): { readonly exitCode: number; readonly output: string } {
  const settlementError = serviceSettlementError(action, status);
  if (!settlementError) return { exitCode: commandExitCode, output: commandOutput };
  return {
    exitCode: commandExitCode === 0 ? 1 : commandExitCode,
    output: [commandOutput.trim(), settlementError].filter(Boolean).join('\n'),
  };
}

function serviceSettlementError(
  action: WatcherServiceActionRequest['action'],
  status: WatcherServiceStatus,
): string | null {
  if ((action === 'start' || action === 'restart') && (!status.running || status.health !== 'healthy')) {
    return [
      `Watcher не перешёл в healthy: ${status.lastError ?? status.health}`,
      serviceFailureDiagnostics(status),
    ].filter(Boolean).join('\n');
  }
  if (action === 'stop' && status.running) {
    return `Watcher не остановился: ${status.lastError ?? 'служба всё ещё RUNNING'}`;
  }
  return null;
}

function serviceFailureDiagnostics(status: WatcherServiceStatus): string | null {
  const reasons: string[] = [];
  const logText = [status.logs?.err, status.logs?.out, status.logs?.wrapper].filter(Boolean).join('\n');
  if (status.projectId || status.root) {
    reasons.push(`field-node ${status.projectId || 'unknown'}: ${status.root || 'root не определён'}. Проверяй именно этот профиль и его Windows service metadata.`);
  }
  if (/\b_npx\b|npm-cache|npm warn cleanup/i.test(logText)) {
    reasons.push('launcher всё ещё запускает npx/npm; служба должна идти через локальный .brain/service/runtime node package.');
  }
  if (/EPERM/i.test(logText) && /(?:npm-cache|_npx)/i.test(logText)) {
    reasons.push('EPERM cleanup в npm-cache указывает на npx/npm runtime footprint; проверь launch-watcher.ps1 и .brain/service/runtime перед повторным start.');
  }
  if (/cannot find module|module_not_found/i.test(logText) && /runtime|watcher\.js/i.test(logText)) {
    reasons.push('локальный service runtime отсутствует или повреждён; нужен repair/install для .brain/service/runtime.');
  }
  if (/already exists|служба уже существует/i.test(logText)) {
    reasons.push('install already exists не является причиной падения watcher; это repair-фолбэк после обновления launcher/XML, дальше решает health после start/restart.');
  }
  if (/unknown command:\s*refresh/i.test(logText)) {
    reasons.push('refresh не поддерживается текущим WinSW; это compatibility fallback, после него нужен обычный start/restart и проверка healthy.');
  }
  if (/Watcher lease rejected:\s*Unauthorized/i.test(logText)) {
    reasons.push('service secret не принят сервером: bearer службы устарел, не совпадает с рабочим MCP_BEARER_TOKEN или не имеет write-доступа к проекту.');
  }
  const staleRoot = findStaleServiceRoot(status.root, logText);
  if (staleRoot) {
    reasons.push(`Windows service metadata указывает на другой root: ${staleRoot}. Ожидался ${status.root}.`);
  }
  if (/WIN32_EXIT_CODE=1067/i.test(status.lastError ?? '')) {
    reasons.push('1067 означает, что Windows Service-процесс завершился после старта; первичная ошибка находится выше в watcher/npm логах.');
  }
  return reasons.length > 0 ? ['Диагностика службы:', ...reasons.map(reason => `- ${reason}`)].join('\n') : null;
}

function findStaleServiceRoot(expectedRoot: string | null, logText: string): string | null {
  if (!expectedRoot) return null;
  const expected = normalizePath(expectedRoot);
  const candidates = windowsPaths(logText)
    .map(serviceRootCandidate)
    .filter((candidate): candidate is string => candidate !== null);
  return candidates.find(candidate => normalizePath(candidate) !== expected) ?? null;
}

function windowsPaths(value: string): readonly string[] {
  return [...value.matchAll(/[A-Za-z]:\\[^\s"']+/g)].map(match => match[0]);
}

function serviceRootCandidate(path: string): string | null {
  const normalized = normalizePath(path);
  if (!normalized.includes('/desktop/') && !normalized.includes('/.brain/')) return null;
  if (normalized.startsWith('c:/windows/') || normalized.includes('/program files/')) return null;
  const brainIndex = normalized.indexOf('/.brain/');
  if (brainIndex !== -1) return path.slice(0, brainIndex);
  const binWatcherIndex = normalized.indexOf('/bin/watcher.js');
  if (binWatcherIndex !== -1) return path.slice(0, binWatcherIndex);
  return path;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
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
  const desktop = await spawnWatcher(command, buildDesktopUpdateArgs(), profile.root, env, {
    timeoutMs: DESKTOP_UPDATE_TIMEOUT_MS,
    timeoutLabel: 'desktop update',
  });
  if (desktop.exitCode !== 0) {
    return updateResult(paths, profile.id, policy, desktop.exitCode, versionReport, ['Пульт не обновлён', desktop.output], desktop.commandStatus);
  }
  const installRaw = await spawnWatcher(command, buildServiceInstallArgs(profile), profile.root, env, serviceSpawnOptions('install'));
  const install = normalizeServiceInstallResult(installRaw.exitCode, installRaw.output);
  if (install.exitCode !== 0) {
    return updateResult(paths, profile.id, policy, install.exitCode, versionReport, ['Пульт обновлён', install.output], installRaw.commandStatus);
  }
  const refreshRaw = installRaw.exitCode === 0 ? null : await refreshServiceMetadata(profile, command, env);
  const refresh = refreshRaw ? normalizeServiceRefreshResult(refreshRaw.exitCode, refreshRaw.output) : null;
  if (refresh && refresh.exitCode !== 0) {
    return updateResult(paths, profile.id, policy, refresh.exitCode, versionReport, [
      'Пульт обновлён',
      install.output,
      'Watcher: service repair: refresh не выполнен.',
      refresh.output,
    ], refreshRaw?.commandStatus);
  }
  const statusAfterRefresh = refreshRaw && refreshRaw.exitCode !== 0 ? readServiceStatus(paths, profile.id) : null;
  const imagePathRaw = statusAfterRefresh && serviceImagePathRepairRequired(statusAfterRefresh) ? await repairServiceImagePath(profile) : null;
  const imagePath = imagePathRaw ? normalizeServiceImagePathRepairResult(imagePathRaw.exitCode, imagePathRaw.output) : null;
  const imagePathRepairSkipped = refreshRaw && refreshRaw.exitCode !== 0 && !imagePath
    ? 'Watcher: service repair: SCM binPath уже указывает на текущий проект, admin repair не нужен.'
    : null;
  if (imagePath && imagePath.exitCode !== 0) {
    return updateResult(paths, profile.id, policy, imagePath.exitCode, versionReport, [
      'Пульт обновлён',
      install.output,
      refresh?.output ?? '',
      'Watcher: service repair: SCM binPath не обновлён.',
      imagePath.output,
    ], imagePathRaw?.commandStatus);
  }
  const restart = await spawnWatcher(command, buildServiceRestartArgs(profile), profile.root, env);
  const status = await waitForServiceActionStatus(paths, 'restart', profile.id);
  const restartSettlement = summarizeServiceActionSettlement('restart', restart.exitCode, restart.output, status);
  const installSummary = installRaw.exitCode === 0
    ? 'Watcher: служба установлена через текущий release.'
    : refreshRaw?.exitCode === 0
      ? 'Watcher: service repair: install already exists, launcher/XML обновлены, refresh выполнен.'
      : imagePath
        ? 'Watcher: service repair: install already exists, launcher/XML обновлены, SCM binPath обновлён, выполнен restart.'
        : 'Watcher: service repair: install already exists, launcher/XML обновлены, SCM binPath уже актуален, выполнен restart.';
  return {
    executed: true,
    policy,
    status,
    exitCode: restartSettlement.exitCode,
    output: [
      versionReport,
      'MCP preflight: обновление не блокируется проверкой сервера. Использую локальный bearer, итоговый доступ проверится после перезапуска watcher.',
      'Пульт: новая версия скачана, установщик запущен.',
      compactOutput(desktop.output),
      installSummary,
      compactOutput(install.output),
      refresh ? compactOutput(refresh.output) : null,
      imagePathRepairSkipped,
      imagePath ? compactOutput(imagePath.output) : null,
      'Watcher: команда перезапуска выполнена.',
      compactOutput(restartSettlement.output),
    ].filter(Boolean).join('\n\n'),
    commandStatus: restart.commandStatus,
  };
}

function updateResult(
  paths: DesktopCorePaths,
  projectId: string,
  policy: WatcherPolicyGate,
  exitCode: number,
  versionReport: string,
  output: readonly string[],
  commandStatus?: WatcherCommandStatus,
): WatcherServiceActionResult {
  return {
    executed: true,
    policy,
    status: readServiceStatus(paths, projectId),
    exitCode,
    output: [versionReport, ...output.map(compactOutput)].filter(Boolean).join('\n\n'),
    ...(commandStatus ? { commandStatus } : {}),
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

async function checkUpdateResult(paths: DesktopCorePaths, projectId: string): Promise<WatcherServiceActionResult> {
  const status = readServiceStatus(paths, projectId);
  try {
    const check = await fetchReleaseVersionCheck(readLocalDesktopVersion(), watcherPackageVersion(WATCHER_PACKAGE));
    const hasUpdate = check.desktop.outdated || check.watcher.outdated;
    return {
      executed: false,
      policy: {
        decision: 'allow',
        risk: 'low',
        reasons: [hasUpdate ? 'Новая версия доступна' : 'Новая версия не найдена'],
      },
      status,
      exitCode: 0,
      output: [
        hasUpdate ? 'Новая версия доступна для скачивания.' : 'Новая версия не найдена. Пульт и watcher актуальны.',
        formatReleaseVersionCheck(check),
      ].join('\n\n'),
    };
  } catch (error) {
    return {
      executed: false,
      policy: { decision: 'allow', risk: 'medium', reasons: ['Проверка версии не завершена'] },
      status,
      exitCode: 1,
      output: [
        `Проверка обновлений не завершена: ${errorMessage(error)}`,
        `Пульт: ${safeLocalDesktopVersion()}`,
        `Watcher: ${watcherPackageVersion(WATCHER_PACKAGE)}`,
      ].join('\n'),
    };
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

function buildServiceActionArgs(action: WatcherServiceActionRequest['action'], profile: SavedProjectProfile): string[] {
  return ['--yes', WATCHER_PACKAGE, 'service', action, ...serviceArgs(profile)];
}

function buildDesktopUpdateArgs(): string[] {
  return ['--yes', WATCHER_PACKAGE, 'desktop', 'update', '--open'];
}

function buildServiceInstallArgs(profile: SavedProjectProfile): string[] {
  return ['--yes', WATCHER_PACKAGE, 'service', 'install', ...serviceArgs(profile)];
}

function buildServiceRefreshArgs(profile: SavedProjectProfile): string[] {
  return ['--yes', WATCHER_PACKAGE, 'service', 'refresh', ...serviceArgs(profile)];
}

function buildServiceRestartArgs(profile: SavedProjectProfile): string[] {
  return ['--yes', WATCHER_PACKAGE, 'service', 'restart', ...serviceArgs(profile)];
}

function serviceArgs(profile: SavedProjectProfile): string[] {
  return [
    '--service-runner',
    'node',
    '--watcher-entry',
    serviceWatcherEntry(profile),
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

function serviceWatcherEntry(profile: SavedProjectProfile): string {
  return join(profile.root, '.brain', 'service', 'runtime-entry.cjs');
}

export function spawnWatcher(
  command: string,
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>>,
  options: SpawnWatcherOptions = {},
): Promise<SpawnWatcherResult> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    const invocation = spawnInvocation(command, args);
    const timeoutMs = options.timeoutMs ?? WATCHER_COMMAND_TIMEOUT_MS;
    const label = options.timeoutLabel ?? command;
    const startedAt = Date.now();
    let timedOut = false;
    let settled = false;
    let killed = false;
    let child: ReturnType<typeof spawn>;
    const finish = (result: SpawnWatcherResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      child = spawn(invocation.command, invocation.args, { cwd, env: { ...process.env, ...env }, windowsHide: true });
    } catch (error) {
      finish(spawnErrorResult(error, invocation.command, label, startedAt, timeoutMs));
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      killed = child.kill();
      finish({
        exitCode: 1,
        output: [
          chunks.join('').trim(),
          `Команда прервана по таймауту: ${label} (${timeoutMs} мс)`,
        ].filter(Boolean).join('\n'),
        commandStatus: commandStatus('timed_out', invocation.command, label, null, null, startedAt, timeoutMs, true, killed),
      });
    }, timeoutMs);
    child.stdout?.on('data', chunk => chunks.push(String(chunk)));
    child.stderr?.on('data', chunk => chunks.push(String(chunk)));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const output = chunks.join('').trim();
      if (timedOut) {
        return;
      }
      const status = signal && code === null ? 'killed' : 'completed';
      finish({
        exitCode: code ?? 1,
        output,
        commandStatus: commandStatus(status, invocation.command, label, code, signal, startedAt, timeoutMs, false, signal !== null),
      });
    });
    child.on('error', error => {
      clearTimeout(timer);
      finish(spawnErrorResult(error, invocation.command, label, startedAt, timeoutMs));
    });
  });
}

function commandStatus(
  status: WatcherCommandStatus['status'],
  command: string,
  label: string,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  startedAt: number,
  timeoutMs: number,
  timedOut: boolean,
  killed: boolean,
): WatcherCommandStatus {
  return {
    status,
    label,
    command,
    exitCode,
    signal,
    durationMs: Math.max(0, Date.now() - startedAt),
    timeoutMs,
    timedOut,
    killed,
  };
}

function spawnErrorResult(
  error: unknown,
  command: string,
  label: string,
  startedAt: number,
  timeoutMs: number,
): SpawnWatcherResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { readonly code?: unknown }).code ?? '')
    : undefined;
  return {
    exitCode: 1,
    output: message,
    commandStatus: {
      ...commandStatus('spawn_error', command, label, 1, null, startedAt, timeoutMs, false, false),
      errorCode: code || undefined,
      errorMessage: message,
    },
  };
}

function serviceSpawnOptions(action: WatcherServiceActionRequest['action']): SpawnWatcherOptions {
  return action === 'install'
    ? { timeoutMs: SERVICE_INSTALL_TIMEOUT_MS, timeoutLabel: 'service install' }
    : { timeoutLabel: `service ${action}` };
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
  const override = process.env.PROJECT_BRAIN_WATCHER_NPX?.trim();
  if (override) return override;
  if (process.platform !== 'win32') return 'npx';
  const localNpx = join(dirname(process.execPath), 'npx.cmd');
  return existsSync(localNpx) ? localNpx : 'npx.cmd';
}

function actionLabel(action: WatcherServiceActionRequest['action']): string {
  const labels = { health: 'Проверить', install: 'Установить службу', start: 'Запустить', stop: 'Остановить', restart: 'Перезапустить', check_update: 'Проверить обновления', update: 'Обновить пульт и watcher' };
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
