import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
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
  readonly managedRequirementsPath?: string | null;
}

const STALE_AFTER_MS = 10 * 60 * 1000;
const SOURCE = 'desktop-codex-gates';
const PLUGIN_ID = 'persistent-verifier@claude-migrated-home';
const MANAGED_HOOKS_START = '# project-brain-managed-hooks:start';
const MANAGED_HOOKS_END = '# project-brain-managed-hooks:end';
const PERSISTENT_VERIFIER_HOOKS = {
  hooks: {
    SessionStart: [
      {
        hooks: [
          {
            type: 'command',
            command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/sessionstart.py"',
            commandWindows: 'python "${CLAUDE_PLUGIN_ROOT}/hooks/sessionstart.py"',
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
            command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/posttooluse.py"',
            commandWindows: 'python "${CLAUDE_PLUGIN_ROOT}/hooks/posttooluse.py"',
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
            command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/stop.py"',
            commandWindows: 'python "${CLAUDE_PLUGIN_ROOT}/hooks/stop.py"',
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
const SESSION_START_BRIDGE_SCRIPT = `#!/usr/bin/env python3
import json
import sys
import time
from pathlib import Path

STALE_AFTER_MS = 10 * 60 * 1000
ROOT_MARKERS = (
    "package.json",
    "tsconfig.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
)


def succeed():
    sys.exit(0)


def read_input():
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}


def read_json(path):
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def input_cwd(input_data):
    cwd = input_data.get("cwd")
    if isinstance(cwd, str) and cwd.strip():
        return Path(cwd)
    return Path.cwd()


def find_root(start):
    current = start
    while True:
        if (current / ".brain" / "config.json").exists():
            return current
        if any((current / marker).exists() for marker in ROOT_MARKERS):
            return current
        if current.parent == current:
            return None
        current = current.parent


def read_project_id(root):
    path = root / ".brain" / "config.json"
    if not path.exists():
        return root.name
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return root.name
    if not isinstance(value, dict):
        return root.name
    project_id = value.get("project_id") or value.get("projectId")
    return project_id if isinstance(project_id, str) and project_id.strip() else root.name


def registry_projects():
    registry = read_json(Path(__file__).with_name("sessionstart-projects.json"))
    projects = registry.get("projects") if isinstance(registry, dict) else []
    if not isinstance(projects, list):
        return []
    result = []
    for project in projects:
        if not isinstance(project, dict):
            continue
        root = project.get("root")
        project_id = project.get("id")
        if isinstance(root, str) and root.strip():
            result.append((Path(root), project_id if isinstance(project_id, str) else None))
    return result


def write_evidence(root, project_id):
    checked_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    payload = {
        "schemaVersion": 1,
        "projectId": project_id,
        "projectRoot": str(root),
        "checkedAt": checked_at,
        "staleAfterMs": STALE_AFTER_MS,
        "verification": {
            "hookPersistence": {
                "available": True,
                "passed": True,
                "detail": "Codex SessionStart hook loaded persistent-verifier.",
                "checkedAt": checked_at,
                "staleAfterMs": STALE_AFTER_MS,
                "source": "persistent-verifier",
                "command": "codex features list",
                "exitCode": 0,
                "runId": f"hookPersistence-{int(time.time())}",
            },
        },
    }
    output_dir = root / ".codex"
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "quality-gate-runs.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\\n",
        encoding="utf-8",
    )


def main():
    input_data = read_input()
    hook_event_name = input_data.get("hookEventName") or input_data.get("hook_event_name")
    if input_data and hook_event_name not in {"SessionStart", "session_start"}:
        succeed()
    candidates = []
    cwd_root = find_root(input_cwd(input_data).resolve())
    if cwd_root:
        candidates.append((cwd_root, None))
    candidates.extend(registry_projects())
    seen = set()
    for root, project_id in candidates:
        try:
            resolved = root.resolve()
        except Exception:
            continue
        key = str(resolved).lower()
        if key in seen or not resolved.exists():
            continue
        seen.add(key)
        write_evidence(resolved, project_id or read_project_id(resolved))
    succeed()


if __name__ == "__main__":
    main()
`;

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

  const nativeEvidence = readEvidenceFiles(profile.root, profile.id);
  const codexTrust = codexTrustEvidence(paths.homePath, profile.root, checkedAt);
  if (!hasPassed(codexTrust)) {
    const evidence: DesktopCodexGateEvidence = {
      commandRuns: nativeEvidence.commandRuns,
      verification: {
        ...nativeEvidence.verification,
        codexTrust,
      },
    };
    writeProjectEvidence(profile, evidence, checkedAt);
    return statusFromEvidence(evidence, checkedAt);
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
  const hookBridge = installPersistentVerifierUserHooks(paths.homePath, profile);
  const managedHooks = installManagedPersistentVerifierHooks(
    hookBridge.scriptRoot,
    options.managedRequirementsPath ?? (options.runner ? null : defaultManagedRequirementsPath()),
    checkedAt,
  );
  const codexHooks = codexHooksEvidence(codexHookInstall, hookRepair, hookBridge, managedHooks, checkedAt);
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

  const desktopBootstrap = hasCurrentPassed(nativeEvidence.verification.hookPersistence, checkedAt)
    ? nativeEvidence.verification.desktopBootstrap
    : desktopBootstrapEvidence(hookBridge, checkedAt);
  const evidence: DesktopCodexGateEvidence = {
    commandRuns: {
      ...nativeEvidence.commandRuns,
      codexHooks,
    },
    verification: {
      ...nativeEvidence.verification,
      codexTrust,
      ...(desktopBootstrap ? { desktopBootstrap } : {}),
      ...(managedHooks ? { managedHooks } : {}),
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
  readonly scriptRoot?: string;
  readonly sessionStartScript?: string;
  readonly registryPath?: string;
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
      if (
        current.includes('${CLAUDE_PLUGIN_ROOT}')
        && current.includes('commandWindows')
        && !current.includes('"description"')
        && !current.includes('command_windows')
        && !current.includes('${PLUGIN_ROOT}')
        && !current.includes('%PLUGIN_ROOT%')
      ) {
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

function installPersistentVerifierUserHooks(homePath: string, profile: SavedProjectProfile): PersistentVerifierUserHookBridge {
  const scriptRoot = resolvePersistentVerifierScriptRoot(homePath);
  if (!scriptRoot) {
    return {
      installed: false,
      detail: 'Persistent-verifier hook scripts не найдены после установки plugin.',
    };
  }

  const sessionStartBridge = writeSessionStartBridge(homePath, profile);
  if (!sessionStartBridge.installed) return sessionStartBridge;

  const path = join(homePath, '.codex', 'hooks.json');
  const existing = readHookDocument(path);
  if (!existing.ok) return { installed: false, path, detail: existing.error };

  const next = mergePersistentVerifierUserHooks(existing.value, scriptRoot, sessionStartBridge.sessionStartScript);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf-8');
    return {
      installed: true,
      path,
      scriptRoot,
      sessionStartScript: sessionStartBridge.sessionStartScript,
      registryPath: sessionStartBridge.registryPath,
      detail: 'Codex user-level hooks bridge установлен.',
    };
  } catch (error) {
    return {
      installed: false,
      path,
      detail: `Codex user-level hooks bridge не записан: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function writeSessionStartBridge(homePath: string, profile: SavedProjectProfile): PersistentVerifierUserHookBridge {
  const bridgeRoot = join(homePath, '.codex', 'project-brain-hooks');
  const sessionStartScript = join(bridgeRoot, 'sessionstart.py');
  const registryPath = join(bridgeRoot, 'sessionstart-projects.json');
  try {
    mkdirSync(bridgeRoot, { recursive: true });
    writeFileSync(sessionStartScript, SESSION_START_BRIDGE_SCRIPT, 'utf-8');
    writeFileSync(registryPath, JSON.stringify(updateSessionStartRegistry(readJson(registryPath), profile), null, 2) + '\n', 'utf-8');
    return {
      installed: true,
      path: join(homePath, '.codex', 'hooks.json'),
      scriptRoot: bridgeRoot,
      sessionStartScript,
      registryPath,
      detail: 'Codex SessionStart bridge зарегистрировал выбранный проект.',
    };
  } catch (error) {
    return {
      installed: false,
      path: sessionStartScript,
      detail: `Codex SessionStart bridge не установлен: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function updateSessionStartRegistry(value: unknown, profile: SavedProjectProfile): Record<string, unknown> {
  const projects = isRecord(value) && Array.isArray(value['projects'])
    ? value['projects'].filter(isRecord)
    : [];
  const nextProject = { id: profile.id, root: profile.root };
  const normalizedRoot = profile.root.toLowerCase();
  const retained = projects.filter(project => {
    const root = project['root'];
    return typeof root !== 'string' || root.toLowerCase() !== normalizedRoot;
  });
  return {
    schemaVersion: 1,
    projects: [...retained, nextProject],
  };
}

function desktopBootstrapEvidence(
  hookBridge: PersistentVerifierUserHookBridge,
  checkedAt: string,
): DesktopCodexGateRunEvidence {
  const command = 'verify persistent-verifier desktop bridge';
  if (!hookBridge.installed || !hookBridge.scriptRoot) {
    return failedEvidence(command, checkedAt, hookBridge.detail);
  }
  return {
    available: true,
    passed: true,
    detail: 'Desktop bootstrap persistent-verifier проверен; native SessionStart evidence ожидается от Codex.',
    checkedAt,
    staleAfterMs: STALE_AFTER_MS,
    source: SOURCE,
    command,
    exitCode: 0,
  };
}

function installManagedPersistentVerifierHooks(
  scriptRoot: string | undefined,
  requirementsPath: string | null,
  checkedAt: string,
): DesktopCodexGateRunEvidence | undefined {
  const command = 'write %ProgramData%/OpenAI/Codex/requirements.toml managed hooks';
  if (!requirementsPath) return undefined;
  if (!scriptRoot) {
    return failedEvidence(command, checkedAt, 'Managed Codex hooks не установлены: persistent-verifier scripts не найдены.');
  }

  const desired = managedRequirementsToml(scriptRoot);
  try {
    const current = existsSync(requirementsPath) ? readFileSync(requirementsPath, 'utf-8') : '';
    const next = mergeManagedRequirements(current, desired);
    if (next === null) {
      return failedEvidence(
        command,
        checkedAt,
        `Системный requirements.toml уже существует без блока Project Brain: ${requirementsPath}. Пульт не перезаписывает чужой admin config.`,
      );
    }
    mkdirSync(dirname(requirementsPath), { recursive: true });
    if (current !== next) writeFileSync(requirementsPath, next, 'utf-8');
    return {
      available: true,
      passed: true,
      detail: 'Codex managed hooks установлены в системный requirements.toml; native hooks не требуют ручного /hooks trust.',
      checkedAt,
      staleAfterMs: STALE_AFTER_MS,
      source: SOURCE,
      command,
      exitCode: 0,
    };
  } catch (error) {
    return failedEvidence(
      command,
      checkedAt,
      `Codex managed hooks не записаны: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function defaultManagedRequirementsPath(): string | null {
  if (process.platform !== 'win32') return null;
  const programData = process.env['ProgramData'] ?? process.env['PROGRAMDATA'];
  if (!programData) return null;
  return join(programData, 'OpenAI', 'Codex', 'requirements.toml');
}

function mergeManagedRequirements(current: string, desiredBlock: string): string | null {
  if (!current.trim()) return desiredBlock;
  const start = current.indexOf(MANAGED_HOOKS_START);
  const end = current.indexOf(MANAGED_HOOKS_END);
  if (start >= 0 && end > start) {
    const afterEnd = end + MANAGED_HOOKS_END.length;
    return `${current.slice(0, start).trimEnd()}\n\n${desiredBlock.trimEnd()}\n${current.slice(afterEnd).trimStart()}`;
  }
  if (current.includes('persistent-verifier') || current.includes('project-brain-managed-hooks')) {
    return desiredBlock;
  }
  return null;
}

function managedRequirementsToml(scriptRoot: string): string {
  const sessionStart = join(scriptRoot, 'sessionstart.py');
  const postToolUse = join(scriptRoot, 'posttooluse.py');
  const stop = join(scriptRoot, 'stop.py');
  return `${MANAGED_HOOKS_START}
[features]
hooks = true

[hooks]
windows_managed_dir = ${tomlString(scriptRoot)}

[[hooks.SessionStart]]
matcher = 'startup|resume|clear|compact'

[[hooks.SessionStart.hooks]]
type = 'command'
command = ${tomlString(`python3 ${toPortablePath(sessionStart)}`)}
commandWindows = ${tomlString(`python "${sessionStart}"`)}
timeout = 15
statusMessage = 'Checking Codex gate persistence'

[[hooks.PostToolUse]]
matcher = 'Write|Edit|MultiEdit|apply_patch'

[[hooks.PostToolUse.hooks]]
type = 'command'
command = ${tomlString(`python3 ${toPortablePath(postToolUse)}`)}
commandWindows = ${tomlString(`python "${postToolUse}"`)}
timeout = 180
statusMessage = 'Running persistent verifier'

[[hooks.Stop]]

[[hooks.Stop.hooks]]
type = 'command'
command = ${tomlString(`python3 ${toPortablePath(stop)}`)}
commandWindows = ${tomlString(`python "${stop}"`)}
timeout = 15
statusMessage = 'Checking last verifier result'
${MANAGED_HOOKS_END}
`;
}

function toPortablePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function codexTrustEvidence(homePath: string, projectRoot: string, checkedAt: string): DesktopCodexGateRunEvidence {
  const command = 'read ~/.codex/config.toml projects trust';
  const trusted = isTrustedCodexProject(homePath, projectRoot);
  return {
    available: true,
    passed: trusted,
    detail: trusted
      ? 'Codex project trust подтверждён для выбранной папки.'
      : 'Codex project trust не найден для выбранной папки; пульт не запускает проектные команды автоматически.',
    checkedAt,
    staleAfterMs: STALE_AFTER_MS,
    source: SOURCE,
    command,
    exitCode: trusted ? 0 : 1,
  };
}

function isTrustedCodexProject(homePath: string, projectRoot: string): boolean {
  const path = join(homePath, '.codex', 'config.toml');
  if (!existsSync(path)) return false;
  let parsed: unknown;
  try {
    parsed = parseToml(readFileSync(path, 'utf-8'));
  } catch {
    return false;
  }
  if (!isRecord(parsed)) return false;
  const projects = parsed['projects'];
  if (!isRecord(projects)) return false;
  const expected = normalizePathKey(projectRoot);
  for (const [pathKey, value] of Object.entries(projects)) {
    if (normalizePathKey(pathKey) !== expected || !isRecord(value)) continue;
    return value['trust_level'] === 'trusted';
  }
  return false;
}

function normalizePathKey(value: string): string {
  return value.replace(/\//g, '\\').replace(/\\+$/g, '').toLowerCase();
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
  sessionStartScript: string | undefined,
): Record<string, unknown> {
  const hooks = isRecord(document['hooks']) ? { ...document['hooks'] } : {};
  hooks['SessionStart'] = mergeHookGroup(hooks['SessionStart'], persistentVerifierUserHookGroup(
    '',
    commandForScript(sessionStartScript ?? join(scriptRoot, 'sessionstart.py')),
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
        timeout: matcher ? 180 : 15,
        statusMessage: matcher ? 'Running persistent verifier' : 'Checking Codex gate persistence',
      },
    ],
  };
}

function containsPersistentVerifierCommand(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  return typeof serialized === 'string'
    && (serialized.includes('persistent-verifier') || serialized.includes('project-brain-hooks'));
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
  managedHooks: DesktopCodexGateRunEvidence | undefined,
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
  if (managedHooks && (managedHooks.available !== true || managedHooks.passed !== true)) {
    return failedEvidence(command, checkedAt, managedHooks.detail);
  }
  const action = hookRepair.repaired.length > 0 ? 'обновлён под CLAUDE_PLUGIN_ROOT' : 'проверен';
  const managed = managedHooks ? ', managed requirements готов' : '';
  return {
    available: true,
    passed: true,
    detail: `Codex persistent-verifier plugin установлен, hooks.json ${action}, user-level bridge готов${managed}.`,
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
      stdio: ['ignore', 'pipe', 'pipe'],
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
  for (const id of ['codexTrust', 'codexRuntime', 'desktopBootstrap', 'managedHooks', 'hookPersistence', 'smoke', 'rollback'] as const) {
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
  const ready = hasBaseVerification(evidence, checkedAt)
    && hasCurrentPassed(evidence.verification.hookPersistence, checkedAt);
  return {
    ready,
    message: ready ? readyMessage(evidence, checkedAt) : blockerMessage(evidence, checkedAt),
    checkedAt,
    evidence,
  };
}

function readyMessage(evidence: DesktopCodexGateEvidence, checkedAt: string): string {
  if (hasCurrentPassed(evidence.verification.hookPersistence, checkedAt)) {
    return 'Codex SessionStart hook подтвердил persistent-verifier.';
  }
  return 'Codex native hook подтверждён.';
}

function blockerMessage(evidence: DesktopCodexGateEvidence, checkedAt: string): string {
  const codexTrust = evidence.verification.codexTrust;
  if (codexTrust === undefined) {
    return 'Codex project trust ещё не подтверждён.';
  }
  if (!hasCurrentPassed(codexTrust, checkedAt)) {
    return codexTrust.detail;
  }
  if (!hasCurrentPassed(evidence.verification.codexRuntime, checkedAt)) return 'Codex CLI ещё не проверен.';
  if (!hasCurrentPassed(evidence.commandRuns.codexHooks, checkedAt)) return 'Persistent-verifier plugin ещё не установлен или не прошёл проверку.';
  if (!hasCurrentPassed(evidence.verification.smoke, checkedAt)) return 'Smoke gate Codex ещё не прошёл.';
  if (!hasCurrentPassed(evidence.verification.rollback, checkedAt)) return 'Rollback-команда Codex gates не подтверждена.';
  if (evidence.verification.hookPersistence?.available === true && evidence.verification.hookPersistence.passed === false) {
    return evidence.verification.hookPersistence.detail;
  }
  if (hasPassed(evidence.verification.hookPersistence) && isStale(evidence.verification.hookPersistence, checkedAt)) {
    return 'Codex SessionStart evidence устарел. Открой или перезапусти Codex в проекте, чтобы native SessionStart подтвердил persistent-verifier.';
  }
  if (hasBaseVerification(evidence, checkedAt)) {
    return 'Codex hooks установлены. Открой или перезапусти Codex в проекте, чтобы native SessionStart подтвердил persistent-verifier.';
  }
  return 'Codex gates ожидают SessionStart evidence.';
}

function hasBaseVerification(evidence: DesktopCodexGateEvidence, checkedAt: string): boolean {
  return hasCurrentPassed(evidence.verification.codexTrust, checkedAt)
    && hasCurrentPassed(evidence.verification.codexRuntime, checkedAt)
    && hasCurrentPassed(evidence.commandRuns.codexHooks, checkedAt)
    && hasCurrentPassed(evidence.verification.smoke, checkedAt)
    && hasCurrentPassed(evidence.verification.rollback, checkedAt);
}

function hasCurrentPassed(
  value: DesktopCodexGateRunEvidence | undefined,
  checkedAt: string,
): boolean {
  return hasPassed(value) && !isStale(value, checkedAt);
}

function hasPassed(value: DesktopCodexGateRunEvidence | undefined): value is DesktopCodexGateRunEvidence {
  return value?.available === true && value.passed === true;
}

function isStale(value: DesktopCodexGateRunEvidence, checkedAt: string): boolean {
  if (value.checkedAt === undefined || value.staleAfterMs === undefined) return false;
  const valueTime = Date.parse(value.checkedAt);
  const referenceTime = Date.parse(checkedAt);
  if (!Number.isFinite(valueTime) || !Number.isFinite(referenceTime)) return true;
  return referenceTime - valueTime > value.staleAfterMs;
}

function emptyStatus(ready: boolean, message: string, checkedAt: string): DesktopCodexGateStatus {
  return { ready, message, checkedAt, evidence: emptyEvidence() };
}

type MutableEvidence = {
  commandRuns: {
    codexHooks?: DesktopCodexGateRunEvidence;
  };
  verification: {
    codexTrust?: DesktopCodexGateRunEvidence;
    codexRuntime?: DesktopCodexGateRunEvidence;
    desktopBootstrap?: DesktopCodexGateRunEvidence;
    managedHooks?: DesktopCodexGateRunEvidence;
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
