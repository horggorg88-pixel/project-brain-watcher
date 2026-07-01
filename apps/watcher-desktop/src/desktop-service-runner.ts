import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, win32 } from 'node:path';
import type {
  SavedProjectProfile,
  WatcherCommandStatus,
  WatcherPolicyGate,
  WatcherServiceAction,
  WatcherServiceActionProgress,
  WatcherServiceActionProgressStep,
  WatcherServiceActionRequest,
  WatcherServiceActionResult,
  WatcherServicePrimaryCause,
  WatcherServiceStatus,
} from './contracts.js';
import { descriptorForCommand, watcherServiceCommandId } from './desktop-command-registry.js';
import { discoverMcpConfig } from './desktop-config-discovery.js';
import { applyMcpConfigToProfile, type DesktopCorePaths } from './desktop-profile-store.js';
import { readDesktopEnvServiceToken, readDesktopServiceToken, stageDesktopServiceSecret, type DesktopServiceSecretState } from './desktop-service-secret.js';
import {
  fetchReleaseVersionCheck,
  formatReleaseVersionCheck,
  readLocalDesktopVersion,
  watcherPackageVersion,
} from './desktop-release-update.js';
import { appendDesktopCommandReceipt } from './desktop-command-ledger.js';
import { attachServiceCommandReceipt } from './desktop-command-receipts.js';
import { type DesktopServerAccessVerification, verifyProjectServerAccess } from './desktop-server-access.js';
import {
  buildServiceImagePathRepairArgs,
  normalizeServiceImagePathRepairResult,
  normalizeServiceInstallResult,
  normalizeServiceRefreshResult,
  readServiceLauncherRepairState,
  serviceImagePathRepairRequired,
  shouldRepairServiceImagePathBeforeAction,
  shouldRepairServiceLauncherBeforeAction,
} from './desktop-service-repair.js';
import { readServiceStatus, resolveServiceProfile } from './desktop-service-status.js';

const WATCHER_PACKAGE = 'https://github.com/horggorg88-pixel/project-brain-watcher/releases/download/v1.4.117/project-brain-watcher-1.4.117.tgz';
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

export interface WatcherCliInvocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly source: 'env-npx' | 'local-npx' | 'path-npx' | 'node-npx-cli' | 'fallback-npx';
}

export interface WatcherCliInvocationResolverInput {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly pathExists?: (path: string) => boolean;
  readonly platform?: NodeJS.Platform;
  readonly processExecPath?: string;
}

export async function runServiceAction(
  paths: DesktopCorePaths,
  request: WatcherServiceActionRequest,
): Promise<WatcherServiceActionResult> {
  const finalize = (result: WatcherServiceActionResult): WatcherServiceActionResult =>
    persistServiceCommandReceipt(paths, attachServiceCommandReceipt(request.action, withServiceActionDiagnostics(request.action, result)));
  const profile = applyMcpConfigToProfile(
    resolveServiceProfile(paths, request.projectId),
    discoverMcpConfig(paths),
  );
  if (request.action === 'health') return finalize(healthResult(paths, request.projectId));
  if (request.action === 'check_update') return finalize(await checkUpdateResult(paths, request.projectId));
  let token = profile ? readDesktopServiceToken(profile) : null;
  const status = readServiceStatus(paths, request.projectId);
  if (request.action === 'start' && status.running) {
    return finalize({
      executed: false,
      policy: { decision: 'allow', risk: 'low', reasons: ['Watcher уже работает'] },
      status,
      exitCode: 0,
      output: `Watcher уже работает, pid=${status.pid ?? 'нет'}. Повторный запуск не требуется.`,
    });
  }
  const policy = servicePolicy(request, profile, token);
  if (policy.decision !== 'allow') {
    return finalize({ executed: false, policy, status: readServiceStatus(paths, request.projectId), exitCode: null, output: policy.reasons.join('\n') });
  }
  if (!profile) {
    return finalize({ executed: false, policy, status: readServiceStatus(paths, request.projectId), exitCode: null, output: 'Проект не найден' });
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
        return finalize({ executed: false, policy: denied, status: readServiceStatus(paths, profile.id), exitCode: null, output: serverAccess.message });
      }
      prepareServiceSecretForLaunch(profile, token);
    }
  }
  const env = token ? { [profile.tokenEnv]: token } : {};
  const watcherCli = resolveWatcherCliInvocation();
  const imagePathRepair = await repairServiceImagePathIfNeeded(profile, status, request.action);
  if (imagePathRepair && imagePathRepair.exitCode !== 0) {
    return finalize({
      executed: true,
      policy,
      status: readServiceStatus(paths, profile.id),
      exitCode: imagePathRepair.exitCode,
      output: imagePathRepair.output,
      commandStatus: imagePathRepair.commandStatus,
    });
  }
  if (request.action === 'update') return finalize(await runUpdateAction(paths, profile, token, policy, imagePathRepair, watcherCli));
  const repair = await repairServiceLauncherIfNeeded(profile, status, request.action, watcherCli, env);
  if (repair && repair.exitCode !== 0) {
    return finalize({
      executed: true,
      policy,
      status: readServiceStatus(paths, profile.id),
      exitCode: repair.exitCode,
      output: repair.output,
      commandStatus: repair.commandStatus,
    });
  }
  if (request.action === 'install' && repair) {
    return finalize({
      executed: true,
      policy,
      status: readServiceStatus(paths, profile.id),
      exitCode: repair.exitCode,
      output: repair.output,
      commandStatus: repair.commandStatus,
    });
  }
  const rawResult = await spawnWatcher(watcherCli.command, [...watcherCli.args, ...buildServiceActionArgs(request.action, profile)], profile.root, env, serviceSpawnOptions(request.action));
  const result = request.action === 'install'
    ? normalizeServiceInstallResult(rawResult.exitCode, rawResult.output)
    : rawResult;
  const finalStatus = await waitForServiceActionStatus(paths, request.action, profile.id);
  const commandOutput = [imagePathRepair?.output, repair?.output, result.output].filter(Boolean).join('\n\n');
  const settlement = summarizeServiceActionSettlement(request.action, result.exitCode, commandOutput, finalStatus);
  return finalize({
    executed: true,
    policy,
    status: finalStatus,
    exitCode: settlement.exitCode,
    output: settlement.output,
    commandStatus: rawResult.commandStatus,
  });
}

function persistServiceCommandReceipt(
  paths: DesktopCorePaths,
  result: WatcherServiceActionResult,
): WatcherServiceActionResult {
  if (!result.receipt) return result;
  const ledger = appendDesktopCommandReceipt(paths, result.receipt);
  if (ledger.saved) return result;
  return {
    ...result,
    output: [
      result.output,
      `Receipt ledger не записан: ${ledger.error ?? 'unknown error'} (${ledger.path})`,
    ].filter(Boolean).join('\n\n'),
  };
}

async function repairServiceImagePathIfNeeded(
  profile: SavedProjectProfile,
  status: WatcherServiceStatus,
  action: WatcherServiceActionRequest['action'],
): Promise<SpawnWatcherResult | null> {
  if (!shouldRepairServiceImagePathBeforeAction(action, status)) return null;
  const raw = await repairServiceImagePath(profile);
  const normalized = normalizeServiceImagePathRepairResult(raw.exitCode, raw.output);
  const output = [
    'service repair: Windows SCM ImagePath указывает не на выбранный проект, переписываю metadata службы.',
    normalized.output,
  ].filter(Boolean).join('\n');
  return { exitCode: normalized.exitCode, output, commandStatus: raw.commandStatus };
}

async function repairServiceLauncherIfNeeded(
  profile: SavedProjectProfile,
  status: WatcherServiceStatus,
  action: WatcherServiceActionRequest['action'],
  watcherCli: WatcherCliInvocation,
  env: Readonly<Record<string, string>>,
): Promise<SpawnWatcherResult | null> {
  const repairState = readServiceLauncherRepairState(profile);
  if (!shouldRepairServiceLauncherBeforeAction(action, status, repairState)) return null;
  const install = await spawnWatcher(watcherCli.command, [...watcherCli.args, ...buildServiceInstallArgs(profile)], profile.root, env, serviceSpawnOptions('install'));
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
    const refreshRaw = await refreshServiceMetadata(profile, watcherCli, env);
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
  watcherCli: WatcherCliInvocation,
  env: Readonly<Record<string, string>>,
): Promise<SpawnWatcherResult> {
  return spawnWatcher(watcherCli.command, [...watcherCli.args, ...buildServiceRefreshArgs(profile)], profile.root, env, {
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
  const logText = serviceDiagnosticText(status, '');
  const primaryCause = classifyServicePrimaryCause(status, logText);
  if (status.projectId || status.root) {
    reasons.push(`field-node ${status.projectId || 'unknown'}: ${status.root || 'root не определён'}. Проверяй именно этот профиль и его Windows service metadata.`);
  }
  if (primaryCause) {
    reasons.push(`${primaryCause.title}: ${primaryCause.detail} ${primaryCause.nextAction}`);
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

function withServiceActionDiagnostics(
  action: WatcherServiceAction,
  result: WatcherServiceActionResult,
): WatcherServiceActionResult {
  const primaryCause = classifyServicePrimaryCause(result.status, result.output, result.commandStatus);
  return {
    ...result,
    primaryCause,
    progress: buildServiceActionProgress(action, result.status, result.commandStatus, result.output, primaryCause),
  };
}

export function classifyServicePrimaryCause(
  status: WatcherServiceStatus,
  output = '',
  commandStatus?: WatcherCommandStatus,
): WatcherServicePrimaryCause | null {
  const text = serviceDiagnosticText(status, output);
  if (/ENOSPC|no space left on device/i.test(text)) {
    return {
      code: 'ENOSPC',
      severity: 'error',
      title: 'Недостаточно места для записи watcher state',
      detail: 'Node не смог записать локальное состояние watcher: ENOSPC/no space left on device.',
      nextAction: 'Освободи место на диске или очисти .brain/service/cache/runtime-staging, затем нажми «Починить службу» и повтори запуск.',
    };
  }
  const staleRuntime = readStaleServiceRuntime(status.root);
  if (staleRuntime) {
    return {
      code: 'SERVICE_RUNTIME_STALE',
      severity: 'error',
      title: 'Service runtime устарел',
      detail: `Служба запускает watcher ${staleRuntime.activeVersion}, а пульт ожидает ${staleRuntime.expectedVersion}.`,
      nextAction: 'Обнови пульт/watcher или нажми «Починить службу», чтобы пересоздать локальный .brain/service runtime.',
    };
  }
  if (/lease already has an active owner|active_owner|owner mismatch|SSE HTTP 409/i.test(text)) {
    return {
      code: 'LEASE_ACTIVE_OWNER',
      severity: 'warning',
      title: 'Watcher lease занят другим owner',
      detail: 'Сервер видит уже активный watcher для этого проекта или старый процесс ещё держит lease.',
      nextAction: 'Останови лишний watcher, подожди lease timeout или перезапусти службу через «Починить службу».',
    };
  }
  if (commandStatus?.timedOut) {
    return {
      code: 'COMMAND_TIMEOUT',
      severity: 'error',
      title: 'Команда службы превысила таймаут',
      detail: `${commandStatus.label} выполнялась ${commandStatus.durationMs} мс и была остановлена.`,
      nextAction: 'Смотри live-прогресс и последние логи; если причина не видна, нажми «Копировать логи» и передай AI snapshot.',
    };
  }
  if (/WIN32_EXIT_CODE=1067/i.test(status.lastError ?? text)) {
    return {
      code: 'SERVICE_1067',
      severity: 'error',
      title: 'Windows Service завершилась после старта',
      detail: 'Код 1067 означает падение процесса watcher после запуска; первичная ошибка обычно выше в err/out/runtime-install логах.',
      nextAction: 'Открой или скопируй логи службы, затем исправь первичную ошибку и повтори запуск.',
    };
  }
  if (status.lastError) {
    return {
      code: 'SERVICE_FAILURE',
      severity: 'error',
      title: 'Watcher требует диагностики',
      detail: status.lastError,
      nextAction: 'Скопируй AI snapshot логов службы и проверь rail_map.required_next.',
    };
  }
  return null;
}

export function buildServiceActionProgress(
  action: WatcherServiceAction,
  status: WatcherServiceStatus,
  commandStatus?: WatcherCommandStatus,
  output = '',
  primaryCause: WatcherServicePrimaryCause | null = classifyServicePrimaryCause(status, output, commandStatus),
): WatcherServiceActionProgress {
  const commandStepStatus = commandProgressStatus(commandStatus);
  const healthPassed = status.running && status.health === 'healthy';
  const healthRelevant = action === 'start' || action === 'restart' || action === 'update' || action === 'install' || action === 'health';
  const healthStatus = healthPassed ? 'passed' : primaryCause ? 'failed' : healthRelevant ? 'running' : 'skipped';
  const steps: readonly WatcherServiceActionProgressStep[] = [
    progressStep('preflight', 'Профиль, bearer и доступ к MCP', status.root ? 'passed' : 'failed', status.root ?? 'root не выбран'),
    progressStep('repair', 'Проверка launcher/XML/service runtime', primaryCause?.code === 'SERVICE_RUNTIME_STALE' ? 'failed' : 'passed', primaryCause?.code === 'SERVICE_RUNTIME_STALE' ? primaryCause.detail : 'metadata проверены перед командой'),
    progressStep('command', 'Команда Windows-службы', commandStepStatus, commandStatus ? `${commandStatus.label}, ${commandStatus.durationMs} мс` : 'команда ещё не запускалась или выполняется'),
    progressStep('health', 'Healthy, lease и синхронизация', healthStatus, healthPassed ? 'watcher healthy' : status.lastError ?? status.health),
    progressStep('diagnostics', 'Логи и первопричина', primaryCause ? 'failed' : status.logs ? 'passed' : 'running', primaryCause?.title ?? 'собираю tail логов службы'),
  ];
  const activeStep = steps.find(step => step.status === 'failed' || step.status === 'running') ?? null;
  return {
    action,
    label: actionLabel(action),
    startedAt: null,
    elapsedMs: commandStatus?.durationMs ?? null,
    activeStepId: activeStep?.id ?? null,
    summary: primaryCause?.title ?? (healthPassed ? 'Watcher healthy' : 'Операция watcher выполняется или требует проверки'),
    primaryCause,
    steps,
  };
}

function commandProgressStatus(commandStatus?: WatcherCommandStatus): WatcherServiceActionProgressStep['status'] {
  if (!commandStatus) return 'running';
  if (commandStatus.status === 'timed_out' || commandStatus.status === 'spawn_error' || commandStatus.exitCode !== 0) return 'failed';
  return 'passed';
}

function progressStep(
  id: WatcherServiceActionProgressStep['id'],
  label: string,
  status: WatcherServiceActionProgressStep['status'],
  detail: string,
): WatcherServiceActionProgressStep {
  return { id, label, status, detail };
}

function serviceDiagnosticText(status: WatcherServiceStatus, output: string): string {
  return [
    output,
    status.lastError,
    status.logs?.err,
    status.logs?.out,
    status.logs?.wrapper,
    status.logs?.runtimeInstall,
  ].filter(Boolean).join('\n');
}

function readStaleServiceRuntime(root: string | null): { readonly activeVersion: string; readonly expectedVersion: string } | null {
  if (!root) return null;
  const manifestPath = join(root, '.brain', 'service', 'active-runtime.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const manifest = parsed as Record<string, unknown>;
    const packageSpec = typeof manifest.packageSpec === 'string' ? manifest.packageSpec : '';
    const activeVersion = serviceRuntimeVersion(packageSpec);
    const expectedVersion = watcherPackageVersion(WATCHER_PACKAGE);
    if (!activeVersion || activeVersion === expectedVersion) return null;
    return { activeVersion, expectedVersion };
  } catch {
    return null;
  }
}

function serviceRuntimeVersion(packageSpec: string): string | null {
  const tgzMatch = packageSpec.match(/project-brain-watcher-(\d+\.\d+\.\d+)\.tgz/i);
  if (tgzMatch?.[1]) return tgzMatch[1];
  const tagMatch = packageSpec.match(/(?:download\/v|#v)(\d+\.\d+\.\d+)/i);
  return tagMatch?.[1] ?? null;
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
  preflightImagePathRepair: SpawnWatcherResult | null,
  watcherCli: WatcherCliInvocation,
): Promise<WatcherServiceActionResult> {
  const versionReport = await updateVersionReport();
  const env = token ? { [profile.tokenEnv]: token } : {};
  const desktop = await spawnWatcher(watcherCli.command, [...watcherCli.args, ...buildDesktopUpdateArgs()], profile.root, env, {
    timeoutMs: DESKTOP_UPDATE_TIMEOUT_MS,
    timeoutLabel: 'desktop update',
  });
  if (desktop.exitCode !== 0) {
    return updateResult(paths, profile.id, policy, desktop.exitCode, versionReport, ['Пульт не обновлён', desktop.output], desktop.commandStatus);
  }
  const installRaw = await spawnWatcher(watcherCli.command, [...watcherCli.args, ...buildServiceInstallArgs(profile)], profile.root, env, serviceSpawnOptions('install'));
  const install = normalizeServiceInstallResult(installRaw.exitCode, installRaw.output);
  if (install.exitCode !== 0) {
    return updateResult(paths, profile.id, policy, install.exitCode, versionReport, ['Пульт обновлён', install.output], installRaw.commandStatus);
  }
  const refreshRaw = installRaw.exitCode === 0 ? null : await refreshServiceMetadata(profile, watcherCli, env);
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
  const restart = await spawnWatcher(watcherCli.command, [...watcherCli.args, ...buildServiceRestartArgs(profile)], profile.root, env);
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
      preflightImagePathRepair ? 'Watcher: SCM ImagePath исправлен перед обновлением.' : null,
      preflightImagePathRepair ? compactOutput(preflightImagePathRepair.output) : null,
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

export function resolveWatcherCliInvocation(input: WatcherCliInvocationResolverInput = {}): WatcherCliInvocation {
  const env = input.env ?? process.env;
  const pathExists = input.pathExists ?? existsSync;
  const platform = input.platform ?? process.platform;
  const processExecPath = input.processExecPath ?? process.execPath;
  const override = env.PROJECT_BRAIN_WATCHER_NPX?.trim();
  if (override) return { command: override, args: [], source: 'env-npx' };
  const localNpx = platform === 'win32'
    ? win32.join(win32.dirname(processExecPath), 'npx.cmd')
    : join(dirname(processExecPath), 'npx');
  if (pathExists(localNpx)) return { command: localNpx, args: [], source: 'local-npx' };
  const pathNpx = findExecutableOnPath(platform === 'win32' ? 'npx.cmd' : 'npx', env, platform, pathExists);
  if (pathNpx) return { command: pathNpx, args: [], source: 'path-npx' };
  const nodeExecutable = resolveNodeExecutable(env, platform, processExecPath, pathExists);
  const npxCliPath = nodeExecutable ? resolveNpxCliPath(nodeExecutable, platform, pathExists) : null;
  if (nodeExecutable && npxCliPath) {
    return { command: nodeExecutable, args: [npxCliPath], source: 'node-npx-cli' };
  }
  return { command: platform === 'win32' ? 'npx.cmd' : 'npx', args: [], source: 'fallback-npx' };
}

function resolveNodeExecutable(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  processExecPath: string,
  pathExists: (path: string) => boolean,
): string | null {
  const override = env.PROJECT_BRAIN_WATCHER_NODE?.trim();
  const pathNode = findExecutableOnPath(platform === 'win32' ? 'node.exe' : 'node', env, platform, pathExists);
  const candidates = platform === 'win32'
    ? [
        override,
        win32.join(win32.dirname(processExecPath), 'node.exe'),
        pathNode,
        win32.join(env.ProgramFiles ?? 'C:\\Program Files', 'nodejs', 'node.exe'),
        win32.join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
      ]
    : [
        override,
        join(dirname(processExecPath), 'node'),
        pathNode,
        '/usr/local/bin/node',
        '/opt/homebrew/bin/node',
        '/usr/bin/node',
      ];
  return uniqueStrings(candidates).find(candidate => pathExists(candidate)) ?? null;
}

function resolveNpxCliPath(
  nodeExecutable: string,
  platform: NodeJS.Platform,
  pathExists: (path: string) => boolean,
): string | null {
  const baseDir = platform === 'win32' ? win32.dirname(nodeExecutable) : dirname(nodeExecutable);
  const candidates = platform === 'win32'
    ? [
        win32.join(baseDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
      ]
    : [
        join(baseDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
        join(baseDir, '..', 'lib', 'node_modules', 'corepack', 'dist', 'npx.js'),
      ];
  return uniqueStrings(candidates).find(candidate => pathExists(candidate)) ?? null;
}

function findExecutableOnPath(
  executable: string,
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  pathExists: (path: string) => boolean,
): string | null {
  const pathValue = platform === 'win32'
    ? env.Path ?? env.PATH ?? env.path ?? ''
    : env.PATH ?? env.Path ?? env.path ?? '';
  const separator = platform === 'win32' ? ';' : delimiter;
  for (const entry of pathValue.split(separator).map(value => value.trim()).filter(Boolean)) {
    const candidate = platform === 'win32' ? win32.join(entry, executable) : join(entry, executable);
    if (pathExists(candidate)) return candidate;
  }
  return null;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}

function actionLabel(action: WatcherServiceActionRequest['action']): string {
  return descriptorForCommand(watcherServiceCommandId(action)).label;
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
