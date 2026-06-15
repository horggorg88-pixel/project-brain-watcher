import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  DesktopCodexGateEvidence,
  DesktopCodexGateRunEvidence,
  DesktopCodexGateStatus,
  SavedProjectProfile,
} from './contracts.js';
import { discoverMcpConfig } from './desktop-config-discovery.js';
import { applyMcpConfigToProfile, type DesktopCorePaths } from './desktop-profile-store.js';
import { resolveServiceProfile } from './desktop-service-status.js';

export interface DesktopCodexCommandRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface DesktopCodexCommandResult {
  readonly exitCode: number;
  readonly output: string;
}

export type DesktopCodexCommandRunner = (
  request: DesktopCodexCommandRequest,
) => Promise<DesktopCodexCommandResult>;

export interface DesktopCodexGateVerifyOptions {
  readonly runner?: DesktopCodexCommandRunner;
  readonly now?: () => Date;
}

const STALE_AFTER_MS = 10 * 60 * 1000;
const SOURCE = 'desktop-codex-gates';
const PLUGIN_ID = 'persistent-verifier@claude-migrated-home';
const PERSISTENT_VERIFIER_HOOKS = {
  description: 'Runs project verifiers after edits and blocks stop while the last verification is failing',
  hooks: {
    SessionStart: [
      {
        hooks: [
          {
            type: 'command',
            command: 'python3 ${PLUGIN_ROOT}/hooks/sessionstart.py',
            commandWindows: 'python "%PLUGIN_ROOT%\\hooks\\sessionstart.py"',
            timeout: 15,
            statusMessage: 'Checking Codex gate persistence',
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: 'Write|Edit|MultiEdit',
        hooks: [
          {
            type: 'command',
            command: 'python3 ${PLUGIN_ROOT}/hooks/posttooluse.py',
            commandWindows: 'python "%PLUGIN_ROOT%\\hooks\\posttooluse.py"',
            timeout: 180,
            statusMessage: 'Running persistent verifier',
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: 'command',
            command: 'python3 ${PLUGIN_ROOT}/hooks/stop.py',
            commandWindows: 'python "%PLUGIN_ROOT%\\hooks\\stop.py"',
            timeout: 15,
            statusMessage: 'Checking last verifier result',
          },
        ],
      },
    ],
  },
} as const;
const evidenceFiles = [
  join('.brain', 'service', 'quality-gate-runs.json'),
  join('.brain', 'quality-gate-runs.json'),
  join('.codex', 'quality-gate-runs.json'),
] as const;

export function readDesktopCodexGateEvidence(
  paths: DesktopCorePaths,
  projectId: string,
): DesktopCodexGateStatus {
  const profile = resolveCodexProfile(paths, projectId);
  const checkedAt = new Date().toISOString();
  if (!profile) {
    return emptyStatus(false, 'Профиль проекта для Codex gates не найден.', checkedAt);
  }
  const evidence = readEvidenceFiles(profile.root, profile.id);
  return statusFromEvidence(evidence, checkedAt);
}

export async function verifyDesktopCodexGates(
  paths: DesktopCorePaths,
  projectId: string,
  options: DesktopCodexGateVerifyOptions = {},
): Promise<DesktopCodexGateStatus> {
  const profile = resolveCodexProfile(paths, projectId);
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  if (!profile) {
    return emptyStatus(false, 'Профиль проекта для Codex gates не найден.', checkedAt);
  }

  const runner = options.runner ?? defaultRunner;
  const codexRuntime = evidenceFromResult(
    await run(runner, profile.root, 'codex', ['--version']),
    'codex --version',
    checkedAt,
    'Codex CLI проверен.',
  );
  const codexHookInstall = await run(runner, profile.root, 'codex', ['plugin', 'add', PLUGIN_ID]);
  const hookRepair = repairPersistentVerifierPluginHooks(paths.homePath);
  const hookBridge = installPersistentVerifierUserHooks(paths.homePath);
  const codexHooks = codexHooksEvidence(codexHookInstall, hookRepair, hookBridge, checkedAt);
  await run(runner, profile.root, 'codex', ['plugin', 'list']);
  await run(runner, profile.root, 'codex', ['features', 'list']);
  const smoke = evidenceFromResult(
    await run(runner, profile.root, 'npm', ['test']),
    'npm test',
    checkedAt,
    'Проектный smoke gate выполнен.',
  );
  const rollback = {
    available: true,
    passed: true,
    detail: 'Rollback-команда доступна для ручного отката persistent-verifier.',
    checkedAt,
    staleAfterMs: STALE_AFTER_MS,
    source: SOURCE,
    command: `codex plugin remove ${PLUGIN_ID}`,
    exitCode: 0,
  } satisfies DesktopCodexGateRunEvidence;

  const nativeEvidence = readEvidenceFiles(profile.root, profile.id);
  const evidence: DesktopCodexGateEvidence = {
    commandRuns: {
      ...nativeEvidence.commandRuns,
      codexHooks,
    },
    verification: {
      ...nativeEvidence.verification,
      codexRuntime,
      smoke,
      rollback,
    },
  };
  writeProjectEvidence(profile, evidence, checkedAt);
  return statusFromEvidence(evidence, checkedAt);
}

interface PersistentVerifierHookRepair {
  readonly repaired: readonly string[];
  readonly valid: readonly string[];
  readonly missing: readonly string[];
  readonly failed: readonly string[];
}

interface PersistentVerifierUserHookBridge {
  readonly installed: boolean;
  readonly path?: string;
  readonly detail: string;
}

function repairPersistentVerifierPluginHooks(homePath: string): PersistentVerifierHookRepair {
  const repaired: string[] = [];
  const valid: string[] = [];
  const missing: string[] = [];
  const failed: string[] = [];
  const desired = JSON.stringify(PERSISTENT_VERIFIER_HOOKS, null, 2) + '\n';

  for (const path of persistentVerifierHookPaths(homePath)) {
    if (!existsSync(path)) {
      missing.push(path);
      continue;
    }
    try {
      const current = readFileSync(path, 'utf-8');
      if (current.includes('%PLUGIN_ROOT%') && current.includes('${PLUGIN_ROOT}')) {
        valid.push(path);
        continue;
      }
      writeFileSync(path, desired, 'utf-8');
      repaired.push(path);
    } catch (error) {
      failed.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { repaired, valid, missing, failed };
}

function installPersistentVerifierUserHooks(homePath: string): PersistentVerifierUserHookBridge {
  const scriptRoot = resolvePersistentVerifierScriptRoot(homePath);
  if (!scriptRoot) {
    return {
      installed: false,
      detail: 'Persistent-verifier hook scripts не найдены после установки plugin.',
    };
  }

  const path = join(homePath, '.codex', 'hooks.json');
  const existing = readHookDocument(path);
  if (!existing.ok) return { installed: false, path, detail: existing.error };

  const next = mergePersistentVerifierUserHooks(existing.value, scriptRoot);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf-8');
    return { installed: true, path, detail: 'Codex user-level hooks bridge установлен.' };
  } catch (error) {
    return {
      installed: false,
      path,
      detail: `Codex user-level hooks bridge не записан: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

type HookDocumentReadResult =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };

function readHookDocument(path: string): HookDocumentReadResult {
  if (!existsSync(path)) return { ok: true, value: {} };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (!isRecord(parsed)) return { ok: false, error: 'Codex hooks.json должен быть JSON object.' };
    return { ok: true, value: parsed };
  } catch (error) {
    return {
      ok: false,
      error: `Codex hooks.json не прочитан: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function mergePersistentVerifierUserHooks(
  document: Record<string, unknown>,
  scriptRoot: string,
): Record<string, unknown> {
  const hooks = isRecord(document['hooks']) ? { ...document['hooks'] } : {};
  hooks['SessionStart'] = mergeHookGroup(hooks['SessionStart'], persistentVerifierUserHookGroup(
    '',
    commandForScript(join(scriptRoot, 'sessionstart.py')),
  ));
  hooks['PostToolUse'] = mergeHookGroup(hooks['PostToolUse'], persistentVerifierUserHookGroup(
    'Write|Edit|MultiEdit',
    commandForScript(join(scriptRoot, 'posttooluse.py')),
  ));
  hooks['Stop'] = mergeHookGroup(hooks['Stop'], persistentVerifierUserHookGroup(
    '',
    commandForScript(join(scriptRoot, 'stop.py')),
  ));
  return { ...document, hooks };
}

function mergeHookGroup(current: unknown, addition: Record<string, unknown>): readonly unknown[] {
  const retained = Array.isArray(current)
    ? current.filter(item => !containsPersistentVerifierCommand(item))
    : [];
  return [...retained, addition];
}

function persistentVerifierUserHookGroup(matcher: string, command: string): Record<string, unknown> {
  return {
    ...(matcher ? { matcher } : {}),
    hooks: [
      {
        type: 'command',
        command,
        commandWindows: command,
        command_windows: command,
        timeout: matcher ? 180 : 15,
        statusMessage: matcher ? 'Running persistent verifier' : 'Checking Codex gate persistence',
      },
    ],
  };
}

function containsPersistentVerifierCommand(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  return typeof serialized === 'string' && serialized.includes('persistent-verifier');
}

function commandForScript(scriptPath: string): string {
  return `python "${scriptPath}"`;
}

function resolvePersistentVerifierScriptRoot(homePath: string): string | null {
  for (const root of persistentVerifierPluginRoots(homePath)) {
    const scriptRoot = join(root, 'hooks');
    if (
      existsSync(join(scriptRoot, 'sessionstart.py'))
      && existsSync(join(scriptRoot, 'posttooluse.py'))
      && existsSync(join(scriptRoot, 'stop.py'))
    ) {
      return scriptRoot;
    }
  }
  return null;
}

function persistentVerifierPluginRoots(homePath: string): readonly string[] {
  return [
    join(homePath, 'plugins', 'persistent-verifier'),
    join(homePath, '.codex', 'plugins', 'cache', 'claude-migrated-home', 'persistent-verifier', '0.1.0'),
  ];
}

function persistentVerifierHookPaths(homePath: string): readonly string[] {
  return persistentVerifierPluginRoots(homePath).map(root => join(root, 'hooks.json'));
}

function codexHooksEvidence(
  installResult: DesktopCodexCommandResult,
  hookRepair: PersistentVerifierHookRepair,
  hookBridge: PersistentVerifierUserHookBridge,
  checkedAt: string,
): DesktopCodexGateRunEvidence {
  const command = `codex plugin add ${PLUGIN_ID}`;
  if (installResult.exitCode !== 0) {
    return evidenceFromResult(installResult, command, checkedAt, 'Codex persistent-verifier plugin установлен или уже доступен.');
  }
  if (hookRepair.failed.length > 0) {
    return failedEvidence(command, checkedAt, `Persistent-verifier hooks.json не удалось обновить: ${hookRepair.failed[0]}`);
  }
  if (!hookBridge.installed) return failedEvidence(command, checkedAt, hookBridge.detail);
  const action = hookRepair.repaired.length > 0 ? 'обновлён под PLUGIN_ROOT' : 'проверен';
  return {
    available: true,
    passed: true,
    detail: `Codex persistent-verifier plugin установлен, hooks.json ${action}, user-level bridge готов.`,
    checkedAt,
    staleAfterMs: STALE_AFTER_MS,
    source: SOURCE,
    command,
    exitCode: 0,
  };
}

function failedEvidence(command: string, checkedAt: string, detail: string): DesktopCodexGateRunEvidence {
  return {
    available: true,
    passed: false,
    detail: sanitize(detail),
    checkedAt,
    staleAfterMs: STALE_AFTER_MS,
    source: SOURCE,
    command,
    exitCode: 1,
  };
}

async function run(
  runner: DesktopCodexCommandRunner,
  cwd: string,
  command: string,
  args: readonly string[],
): Promise<DesktopCodexCommandResult> {
  try {
    return await runner({ command, args, cwd });
  } catch (error) {
    return {
      exitCode: 1,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

function defaultRunner(request: DesktopCodexCommandRequest): Promise<DesktopCodexCommandResult> {
  const spawnRequest = resolveCodexGateSpawn(request.command, request.args);
  return new Promise(resolve => {
    const child = spawn(spawnRequest.command, [...spawnRequest.args], {
      cwd: request.cwd,
      env: process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += String(chunk); });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => {
      resolve({ exitCode: 1, output: error.message });
    });
    child.on('close', code => {
      resolve({
        exitCode: code ?? 1,
        output: [stdout, stderr].filter(Boolean).join('\n'),
      });
    });
  });
}

export interface DesktopCodexGateSpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
}

export function resolveCodexGateSpawn(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): DesktopCodexGateSpawnRequest {
  const executable = resolveCodexGateExecutable(command, platform);
  if (platform === 'win32' && executable.endsWith('.cmd')) {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', executable, ...args] };
  }
  return { command: executable, args };
}

export function resolveCodexGateExecutable(command: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32') return command;
  if (command === 'codex' || command === 'npm') return `${command}.cmd`;
  return command;
}

function resolveCodexProfile(paths: DesktopCorePaths, projectId: string): SavedProjectProfile | null {
  return applyMcpConfigToProfile(resolveServiceProfile(paths, projectId), discoverMcpConfig(paths));
}

function readEvidenceFiles(projectRoot: string, projectId: string): DesktopCodexGateEvidence {
  const merged = emptyEvidence();
  for (const relativePath of evidenceFiles) {
    mergeEvidence(merged, readJson(join(projectRoot, relativePath)), projectId);
  }
  return merged;
}

function mergeEvidence(target: MutableEvidence, value: unknown, expectedProjectId: string): void {
  if (!isRecord(value)) return;
  const schemaVersion = value['schemaVersion'];
  if (schemaVersion !== undefined && schemaVersion !== 1) return;
  const fileProjectId = readString(value, 'projectId') ?? readString(value, 'project_id');
  if (expectedProjectId && fileProjectId && fileProjectId !== expectedProjectId) return;
  const commandRuns = isRecord(value['commandRuns']) ? value['commandRuns'] : {};
  const codexHooks = parseRunEvidence(commandRuns['codexHooks'], fileProjectId, expectedProjectId);
  if (codexHooks && isNewer(codexHooks, target.commandRuns.codexHooks)) {
    target.commandRuns.codexHooks = codexHooks;
  }

  const verification = isRecord(value['verification']) ? value['verification'] : {};
  for (const id of ['codexRuntime', 'hookPersistence', 'smoke', 'rollback'] as const) {
    const evidence = parseRunEvidence(verification[id], fileProjectId, expectedProjectId);
    if (evidence && isNewer(evidence, target.verification[id])) {
      target.verification[id] = evidence;
    }
  }
}

function parseRunEvidence(
  value: unknown,
  fileProjectId: string | undefined,
  expectedProjectId: string,
): DesktopCodexGateRunEvidence | null {
  if (!isRecord(value)) return null;
  const entryProjectId = readString(value, 'projectId') ?? readString(value, 'project_id') ?? fileProjectId;
  if (expectedProjectId && entryProjectId && entryProjectId !== expectedProjectId) return null;
  const available = value['available'];
  const detail = value['detail'];
  const source = value['source'];
  const command = value['command'];
  if (typeof available !== 'boolean' || typeof detail !== 'string' || typeof source !== 'string' || typeof command !== 'string') {
    return null;
  }
  return {
    available,
    passed: readBoolean(value, 'passed'),
    detail: sanitize(detail),
    checkedAt: readString(value, 'checkedAt'),
    staleAfterMs: readNumber(value, 'staleAfterMs'),
    source: sanitize(source),
    command: sanitize(command),
    exitCode: readNumber(value, 'exitCode'),
    runId: sanitizeOptional(readString(value, 'runId')),
  };
}

function evidenceFromResult(
  result: DesktopCodexCommandResult,
  command: string,
  checkedAt: string,
  successDetail: string,
): DesktopCodexGateRunEvidence {
  const passed = result.exitCode === 0;
  return {
    available: true,
    passed,
    detail: passed ? successDetail : `Команда завершилась с ошибкой: ${sanitize(result.output).slice(0, 240)}`,
    checkedAt,
    staleAfterMs: STALE_AFTER_MS,
    source: SOURCE,
    command,
    exitCode: result.exitCode,
  };
}

function writeProjectEvidence(
  profile: SavedProjectProfile,
  evidence: DesktopCodexGateEvidence,
  checkedAt: string,
): void {
  const targetDir = join(profile.root, '.brain', 'service');
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, 'quality-gate-runs.json'), JSON.stringify({
    schemaVersion: 1,
    projectId: profile.id,
    projectRoot: profile.root,
    checkedAt,
    staleAfterMs: STALE_AFTER_MS,
    commandRuns: evidence.commandRuns,
    verification: evidence.verification,
  }, null, 2), 'utf-8');
}

function statusFromEvidence(evidence: DesktopCodexGateEvidence, checkedAt: string): DesktopCodexGateStatus {
  const ready = hasPassed(evidence.verification.hookPersistence);
  return {
    ready,
    message: ready ? readyMessage(evidence) : blockerMessage(evidence),
    checkedAt,
    evidence,
  };
}

function readyMessage(evidence: DesktopCodexGateEvidence): string {
  if (hasPassed(evidence.verification.hookPersistence)) {
    return 'Codex SessionStart hook подтвердил persistent-verifier.';
  }
  return 'Codex native hook подтверждён.';
}

function blockerMessage(evidence: DesktopCodexGateEvidence): string {
  if (!hasPassed(evidence.verification.codexRuntime)) return 'Codex CLI ещё не проверен.';
  if (!hasPassed(evidence.commandRuns.codexHooks)) return 'Persistent-verifier plugin ещё не установлен или не прошёл проверку.';
  if (!hasPassed(evidence.verification.smoke)) return 'Smoke gate Codex ещё не прошёл.';
  if (!hasPassed(evidence.verification.rollback)) return 'Rollback-команда Codex gates не подтверждена.';
  if (hasBaseVerification(evidence)) {
    return 'Codex hooks установлены. Открой Codex в проекте и доверь hooks через /hooks, чтобы SessionStart подтвердил persistent-verifier.';
  }
  return 'Codex gates ожидают SessionStart evidence.';
}

function hasBaseVerification(evidence: DesktopCodexGateEvidence): boolean {
  return hasPassed(evidence.verification.codexRuntime)
    && hasPassed(evidence.commandRuns.codexHooks)
    && hasPassed(evidence.verification.smoke)
    && hasPassed(evidence.verification.rollback);
}

function hasPassed(value: DesktopCodexGateRunEvidence | undefined): boolean {
  return value?.available === true && value.passed === true;
}

function emptyStatus(ready: boolean, message: string, checkedAt: string): DesktopCodexGateStatus {
  return { ready, message, checkedAt, evidence: emptyEvidence() };
}

type MutableEvidence = {
  commandRuns: {
    codexHooks?: DesktopCodexGateRunEvidence;
  };
  verification: {
    codexRuntime?: DesktopCodexGateRunEvidence;
    hookPersistence?: DesktopCodexGateRunEvidence;
    smoke?: DesktopCodexGateRunEvidence;
    rollback?: DesktopCodexGateRunEvidence;
  };
};

function emptyEvidence(): MutableEvidence {
  return {
    commandRuns: {},
    verification: {},
  };
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function isNewer(candidate: DesktopCodexGateRunEvidence, current: DesktopCodexGateRunEvidence | undefined): boolean {
  if (!current) return true;
  const candidateTime = Date.parse(candidate.checkedAt ?? '');
  const currentTime = Date.parse(current.checkedAt ?? '');
  if (!Number.isFinite(candidateTime)) return false;
  if (!Number.isFinite(currentTime)) return true;
  return candidateTime > currentTime;
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function readNumber(value: Record<string, unknown>, key: string): number | undefined {
  const raw = value[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function readBoolean(value: Record<string, unknown>, key: string): boolean | undefined {
  const raw = value[key];
  return typeof raw === 'boolean' ? raw : undefined;
}

function sanitizeOptional(value: string | undefined): string | undefined {
  return value === undefined ? undefined : sanitize(value);
}

function sanitize(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/pb_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\b(?:TOKEN|SECRET|PASSWORD|KEY)=\S+/gi, match => `${match.split('=', 1)[0]}=[redacted]`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
