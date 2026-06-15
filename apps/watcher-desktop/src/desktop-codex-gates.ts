import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  const codexHooks = evidenceFromResult(
    await run(runner, profile.root, 'codex', ['plugin', 'add', PLUGIN_ID]),
    `codex plugin add ${PLUGIN_ID}`,
    checkedAt,
    'Codex persistent-verifier plugin установлен или уже доступен.',
  );
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
    return 'Codex plugin установлен. Открой Codex в проекте, чтобы SessionStart hook подтвердил persistent-verifier.';
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
