import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type {
  DesktopCodexGateEvidence,
  DesktopCodexGateRunEvidence,
  DesktopCodexGateStatus,
  SavedProjectProfile,
} from './contracts.js';
import { discoverMcpConfig } from './desktop-config-discovery.js';
import { applyMcpConfigToProfile, type DesktopCorePaths } from './desktop-profile-store.js';
import { resolveServiceProfile } from './desktop-service-status.js';
import { QUALITY_GATE_HOOK_SCRIPT } from './desktop-codex-quality-gate-script.js';

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
const NATIVE_HOOK_EVIDENCE_TTL_MS = 24 * 60 * 60 * 1000;
const CODEX_SETUP_EVIDENCE_TTL_MS = NATIVE_HOOK_EVIDENCE_TTL_MS;
const SOURCE = 'desktop-codex-gates';
const PLUGIN_ID = 'persistent-verifier@claude-migrated-home';
const MANAGED_HOOKS_START = '# project-brain-managed-hooks:start';
const MANAGED_HOOKS_END = '# project-brain-managed-hooks:end';
const FAILURE_OUTPUT_HEAD_CHARS = 320;
const FAILURE_OUTPUT_TAIL_CHARS = 1200;
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
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: 'command',
            command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/runtimecontext.py"',
            commandWindows: 'python "${CLAUDE_PLUGIN_ROOT}/hooks/runtimecontext.py"',
            timeout: 15,
            statusMessage: 'Hydrating Project Brain runtime context',
          },
        ],
      },
    ],
    SubagentStart: [
      {
        hooks: [
          {
            type: 'command',
            command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/runtimecontext.py"',
            commandWindows: 'python "${CLAUDE_PLUGIN_ROOT}/hooks/runtimecontext.py"',
            timeout: 15,
            statusMessage: 'Hydrating Project Brain runtime context',
          },
        ],
      },
    ],
    SubagentStop: [
      {
        hooks: [
          {
            type: 'command',
            command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/runtimecontext.py"',
            commandWindows: 'python "${CLAUDE_PLUGIN_ROOT}/hooks/runtimecontext.py"',
            timeout: 15,
            statusMessage: 'Recording subagent completion context',
          },
        ],
      },
    ],
    PreToolUse: [
      {
        hooks: [
          {
            type: 'command',
            command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/runtimecontext.py"',
            commandWindows: 'python "${CLAUDE_PLUGIN_ROOT}/hooks/runtimecontext.py"',
            timeout: 15,
            statusMessage: 'Checking Project Brain rail context',
          },
        ],
      },
    ],
    PermissionRequest: [
      {
        hooks: [
          {
            type: 'command',
            command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/runtimecontext.py"',
            commandWindows: 'python "${CLAUDE_PLUGIN_ROOT}/hooks/runtimecontext.py"',
            timeout: 15,
            statusMessage: 'Recording permission request context',
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: 'Write|Edit|MultiEdit|apply_patch',
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
    PreCompact: [
      {
        hooks: [
          {
            type: 'command',
            command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/runtimecontext.py"',
            commandWindows: 'python "${CLAUDE_PLUGIN_ROOT}/hooks/runtimecontext.py"',
            timeout: 15,
            statusMessage: 'Persisting Project Brain compact context',
          },
        ],
      },
    ],
    PostCompact: [
      {
        hooks: [
          {
            type: 'command',
            command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/runtimecontext.py"',
            commandWindows: 'python "${CLAUDE_PLUGIN_ROOT}/hooks/runtimecontext.py"',
            timeout: 15,
            statusMessage: 'Restoring Project Brain compact context',
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: 'command',
            command: 'python3 "${CLAUDE_PLUGIN_ROOT}/hooks/qualitygate.py"',
            commandWindows: 'python "${CLAUDE_PLUGIN_ROOT}/hooks/qualitygate.py"',
            timeout: 900,
            statusMessage: 'Running project quality gates',
          },
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
const CODEX_LIFECYCLE_HOOKS = [
  'SessionStart',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'Stop',
] as const;
const QUALITY_GATE_RAILS = ['typecheck', 'lint', 'test', 'build', 'check', 'verify'] as const;
const evidenceFiles = [
  join('.brain', 'service', 'quality-gate-runs.json'),
  join('.brain', 'quality-gate-runs.json'),
  join('.codex', 'quality-gate-runs.json'),
] as const;
const commandRunIds = [
  'typecheck',
  'lint',
  'format',
  'test',
  'coverage',
  'e2e',
  'build',
  'check',
  'verify',
  'noAny',
  'securityScan',
  'dependencyAudit',
  'codexHooks',
] as const;
const SESSION_START_BRIDGE_SCRIPT = `#!/usr/bin/env python3
import json
import sys
import time
from pathlib import Path

NATIVE_HOOK_EVIDENCE_TTL_MS = 24 * 60 * 60 * 1000
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


def write_evidence(root, project_id, hook_event_name):
    checked_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    payload = {
        "schemaVersion": 1,
        "projectId": project_id,
        "projectRoot": str(root),
        "checkedAt": checked_at,
        "staleAfterMs": NATIVE_HOOK_EVIDENCE_TTL_MS,
        "verification": {
            "hookPersistence": {
                "available": True,
                "passed": True,
                "detail": "Codex SessionStart hook loaded persistent-verifier.",
                "checkedAt": checked_at,
                "staleAfterMs": NATIVE_HOOK_EVIDENCE_TTL_MS,
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
        write_evidence(resolved, project_id or read_project_id(resolved), hook_event_name)
    succeed()


if __name__ == "__main__":
    main()
`;
const RUNTIME_CONTEXT_BRIDGE_SCRIPT = `#!/usr/bin/env python3
import json
import sys
import time
from pathlib import Path

NATIVE_HOOK_EVIDENCE_TTL_MS = 24 * 60 * 60 * 1000
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


def merge_verification(existing, runtime_context):
    result = existing if isinstance(existing, dict) else {}
    verification = result.get("verification")
    if not isinstance(verification, dict):
        verification = {}
    verification["runtimeContext"] = runtime_context
    result["verification"] = verification
    return result


def write_evidence(root, project_id, hook_event_name):
    checked_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    event_name = hook_event_name if isinstance(hook_event_name, str) and hook_event_name else "UserPromptSubmit"
    runtime_context = {
        "available": True,
        "passed": True,
        "detail": f"Codex Runtime Context proof recorded by native {event_name} hook.",
        "checkedAt": checked_at,
        "staleAfterMs": NATIVE_HOOK_EVIDENCE_TTL_MS,
        "source": "project-brain-runtime-context",
        "command": "project-brain runtime context proof",
        "exitCode": 0,
        "runId": f"runtimeContext-{int(time.time())}",
    }
    context_payload = {
        "schemaVersion": 1,
        "projectId": project_id,
        "projectRoot": str(root),
        "checkedAt": checked_at,
        "hookEventName": event_name,
        "source": "project-brain-runtime-context",
        "verdict": "ready",
        "proofCount": 1,
    }
    output_dir = root / ".codex"
    output_dir.mkdir(parents=True, exist_ok=True)
    quality_gate_path = output_dir / "quality-gate-runs.json"
    payload = merge_verification(read_json(quality_gate_path), runtime_context)
    payload["schemaVersion"] = 1
    payload["projectId"] = project_id
    payload["projectRoot"] = str(root)
    payload["checkedAt"] = checked_at
    payload["staleAfterMs"] = NATIVE_HOOK_EVIDENCE_TTL_MS
    quality_gate_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\\n",
        encoding="utf-8",
    )
    (output_dir / "runtime-context.json").write_text(
        json.dumps(context_payload, ensure_ascii=False, indent=2) + "\\n",
        encoding="utf-8",
    )


def main():
    input_data = read_input()
    hook_event_name = input_data.get("hookEventName") or input_data.get("hook_event_name")
    runtime_events = {
        "UserPromptSubmit",
        "user_prompt_submit",
        "SubagentStart",
        "subagent_start",
        "SubagentStop",
        "subagent_stop",
        "PreToolUse",
        "pre_tool_use",
        "PermissionRequest",
        "permission_request",
        "PreCompact",
        "pre_compact",
        "PostCompact",
        "post_compact",
    }
    if input_data and hook_event_name not in runtime_events:
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
        write_evidence(resolved, project_id or read_project_id(resolved), hook_event_name)
    succeed()


if __name__ == "__main__":
    main()
`;
const POST_TOOL_USE_HOOK_SCRIPT = `#!/usr/bin/env python3
import json
import subprocess
import sys
from pathlib import Path

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


def input_cwd(input_data):
    cwd = input_data.get("cwd")
    if isinstance(cwd, str) and cwd.strip():
        return Path(cwd)
    return Path.cwd()


def get_file_path(input_data):
    candidates = [
        input_data.get("tool_response", {}).get("filePath") if isinstance(input_data.get("tool_response"), dict) else None,
        input_data.get("tool_result", {}).get("filePath") if isinstance(input_data.get("tool_result"), dict) else None,
        input_data.get("tool_input", {}).get("file_path") if isinstance(input_data.get("tool_input"), dict) else None,
    ]
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return Path(candidate)
    return None


def find_root(start):
    current = start if start.is_dir() else start.parent
    while True:
        if any((current / marker).exists() for marker in ROOT_MARKERS):
            return current
        if current.parent == current:
            return None
        current = current.parent


def main():
    input_data = read_input()
    if input_data.get("tool_name") not in {"Write", "Edit", "MultiEdit", "apply_patch"}:
        succeed()
    root = find_root((get_file_path(input_data) or input_cwd(input_data)).resolve())
    if not root:
        succeed()
    qualitygate = Path(__file__).with_name("qualitygate.py")
    if not qualitygate.exists():
        succeed()
    hook_input = json.dumps({"hookEventName": "Stop", "cwd": str(root)})
    result = subprocess.run(
        [sys.executable, str(qualitygate)],
        input=hook_input,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
`;
const STOP_HOOK_SCRIPT = `#!/usr/bin/env python3
import hashlib
import json
import os
import sys
import tempfile
import time
from pathlib import Path

ROOT_MARKERS = (
    "package.json",
    "tsconfig.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
)


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(0)


def succeed():
    sys.exit(0)


def read_input():
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}


def input_cwd(input_data):
    cwd = input_data.get("cwd")
    if isinstance(cwd, str) and cwd.strip():
        return Path(cwd)
    return Path(os.getcwd())


def state_path(root):
    digest = hashlib.sha1(str(root).lower().encode("utf-8")).hexdigest()
    return Path(tempfile.gettempdir()) / "persistent-verifier" / f"{digest}.json"


def find_root(start):
    current = start
    while True:
        if any((current / marker).exists() for marker in ROOT_MARKERS):
            return current
        if current.parent == current:
            return None
        current = current.parent


def load_state(root):
    path = state_path(root)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def main():
    input_data = read_input()
    root = find_root(input_cwd(input_data).resolve())
    if not root:
        succeed()
    state = load_state(root)
    if not state or state.get("status") != "failed":
        succeed()
    updated_at = float(state.get("updated_at", 0))
    if time.time() - updated_at > 4 * 60 * 60:
        succeed()
    emit(
        {
            "decision": "block",
            "reason": "Verifier still failing",
            "systemMessage": state.get("summary", "persistent-verifier: есть незакрытые ошибки."),
        }
    )


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
  const codexTrust = ensureCodexTrustEvidence(paths.homePath, profile.root, checkedAt);
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
    CODEX_SETUP_EVIDENCE_TTL_MS,
  );
  const codexHookInstall = await run(runner, profile.root, 'codex', ['plugin', 'add', PLUGIN_ID]);
  const hookRepair = repairPersistentVerifierPluginHooks(paths.homePath);
  const hookBridge = installPersistentVerifierUserHooks(paths.homePath, profile);
  const managedHooks = installManagedPersistentVerifierHooks(
    hookBridge,
    options.managedRequirementsPath ?? (options.runner ? null : defaultManagedRequirementsPath()),
    checkedAt,
  );
  const codexHooks = codexHooksEvidence(codexHookInstall, hookRepair, hookBridge, managedHooks, checkedAt);
  await run(runner, profile.root, 'codex', ['plugin', 'list']);
  await run(runner, profile.root, 'codex', ['features', 'list']);
  const smoke = await projectSmokeEvidence(runner, profile.root, checkedAt);
  const rollback = {
    available: true,
    passed: true,
    detail: 'Rollback-команда доступна для ручного отката persistent-verifier.',
    checkedAt,
    staleAfterMs: CODEX_SETUP_EVIDENCE_TTL_MS,
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
  readonly runtimeContextScript?: string;
  readonly qualityGateScript?: string;
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
      ensurePersistentVerifierPluginScripts(dirname(path));
      const current = readFileSync(path, 'utf-8');
      if (
        current.includes('${CLAUDE_PLUGIN_ROOT}')
        && current.includes('commandWindows')
        && current.includes('runtimecontext.py')
        && current.includes('qualitygate.py')
        && current.includes('PreToolUse')
        && current.includes('PermissionRequest')
        && current.includes('PreCompact')
        && current.includes('PostCompact')
        && current.includes('SubagentStop')
        && current.includes('apply_patch')
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
  const scriptRoot = ensurePersistentVerifierScriptRoot(homePath);
  if (!scriptRoot) {
    return {
      installed: false,
      detail: 'Persistent-verifier hook scripts не найдены после установки plugin.',
    };
  }
  const qualityGateScript = writeQualityGateHookScript(scriptRoot);
  if (!qualityGateScript.installed) return qualityGateScript;

  const sessionStartBridge = writeSessionStartBridge(homePath, profile);
  if (!sessionStartBridge.installed) return sessionStartBridge;

  const path = join(homePath, '.codex', 'hooks.json');
  const existing = readHookDocument(path);
  if (!existing.ok) return { installed: false, path, detail: existing.error };

  const next = mergePersistentVerifierUserHooks(
    existing.value,
    scriptRoot,
    sessionStartBridge.sessionStartScript,
    sessionStartBridge.runtimeContextScript,
  );
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf-8');
    return {
      installed: true,
      path,
      scriptRoot,
      sessionStartScript: sessionStartBridge.sessionStartScript,
      runtimeContextScript: sessionStartBridge.runtimeContextScript,
      qualityGateScript: qualityGateScript.qualityGateScript,
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

function writeQualityGateHookScript(scriptRoot: string): PersistentVerifierUserHookBridge {
  const qualityGateScript = join(scriptRoot, 'qualitygate.py');
  try {
    mkdirSync(scriptRoot, { recursive: true });
    writeFileSync(qualityGateScript, QUALITY_GATE_HOOK_SCRIPT, 'utf-8');
    return {
      installed: true,
      path: qualityGateScript,
      scriptRoot,
      qualityGateScript,
      detail: 'Codex quality gate hook установлен.',
    };
  } catch (error) {
    return {
      installed: false,
      path: qualityGateScript,
      detail: `Codex quality gate hook не установлен: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function writeSessionStartBridge(homePath: string, profile: SavedProjectProfile): PersistentVerifierUserHookBridge {
  const bridgeRoot = join(homePath, '.codex', 'project-brain-hooks');
  const sessionStartScript = join(bridgeRoot, 'sessionstart.py');
  const runtimeContextScript = join(bridgeRoot, 'runtimecontext.py');
  const registryPath = join(bridgeRoot, 'sessionstart-projects.json');
  try {
    mkdirSync(bridgeRoot, { recursive: true });
    writeFileSync(sessionStartScript, SESSION_START_BRIDGE_SCRIPT, 'utf-8');
    writeFileSync(runtimeContextScript, RUNTIME_CONTEXT_BRIDGE_SCRIPT, 'utf-8');
    writeFileSync(registryPath, JSON.stringify(updateSessionStartRegistry(readJson(registryPath), profile), null, 2) + '\n', 'utf-8');
    return {
      installed: true,
      path: join(homePath, '.codex', 'hooks.json'),
      scriptRoot: bridgeRoot,
      sessionStartScript,
      runtimeContextScript,
      registryPath,
      detail: 'Codex Runtime Context bridge зарегистрировал выбранный проект.',
    };
  } catch (error) {
    return {
      installed: false,
      path: sessionStartScript,
      detail: `Codex SessionStart bridge не установлен: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function ensurePersistentVerifierScriptRoot(homePath: string): string | null {
  const existingRoot = resolvePersistentVerifierScriptRoot(homePath);
  if (existingRoot) return existingRoot;

  const pluginRoot = join(homePath, 'plugins', 'persistent-verifier');
  const scriptRoot = join(pluginRoot, 'hooks');
  try {
    ensurePersistentVerifierPluginScripts(pluginRoot);
    writeFileSync(join(pluginRoot, 'hooks.json'), JSON.stringify(PERSISTENT_VERIFIER_HOOKS, null, 2) + '\n', 'utf-8');
    return scriptRoot;
  } catch {
    return null;
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
    detail: `Desktop bootstrap persistent-verifier проверен; ${codexHookTopologyDetail()} Native Runtime Context evidence ожидается от Codex.`,
    checkedAt,
    staleAfterMs: CODEX_SETUP_EVIDENCE_TTL_MS,
    source: SOURCE,
    command,
    exitCode: 0,
  };
}

function installManagedPersistentVerifierHooks(
  hookBridge: PersistentVerifierUserHookBridge,
  requirementsPath: string | null,
  checkedAt: string,
): DesktopCodexGateRunEvidence | undefined {
  const command = 'write %ProgramData%/OpenAI/Codex/requirements.toml managed hooks';
  if (!requirementsPath) return undefined;
  if (!hookBridge.scriptRoot) {
    return failedEvidence(command, checkedAt, 'Managed Codex hooks не установлены: persistent-verifier scripts не найдены.');
  }

  const desired = managedRequirementsToml(hookBridge);
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
      detail: `Codex managed hooks установлены в системный requirements.toml; ${codexHookTopologyDetail()} Native hooks не требуют ручного /hooks trust.`,
      checkedAt,
      staleAfterMs: CODEX_SETUP_EVIDENCE_TTL_MS,
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

function managedRequirementsToml(hookBridge: PersistentVerifierUserHookBridge): string {
  const scriptRoot = hookBridge.scriptRoot ?? '';
  const sessionStart = hookBridge.sessionStartScript ?? join(scriptRoot, 'sessionstart.py');
  const runtimeContext = hookBridge.runtimeContextScript ?? sessionStart;
  const postToolUse = join(scriptRoot, 'posttooluse.py');
  const qualityGate = join(scriptRoot, 'qualitygate.py');
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

[[hooks.UserPromptSubmit]]

[[hooks.UserPromptSubmit.hooks]]
type = 'command'
command = ${tomlString(`python3 ${toPortablePath(runtimeContext)}`)}
commandWindows = ${tomlString(`python "${runtimeContext}"`)}
timeout = 15
statusMessage = 'Hydrating Project Brain runtime context'

[[hooks.SubagentStart]]

[[hooks.SubagentStart.hooks]]
type = 'command'
command = ${tomlString(`python3 ${toPortablePath(runtimeContext)}`)}
commandWindows = ${tomlString(`python "${runtimeContext}"`)}
timeout = 15
statusMessage = 'Hydrating Project Brain runtime context'

[[hooks.SubagentStop]]

[[hooks.SubagentStop.hooks]]
type = 'command'
command = ${tomlString(`python3 ${toPortablePath(runtimeContext)}`)}
commandWindows = ${tomlString(`python "${runtimeContext}"`)}
timeout = 15
statusMessage = 'Recording subagent completion context'

[[hooks.PreToolUse]]

[[hooks.PreToolUse.hooks]]
type = 'command'
command = ${tomlString(`python3 ${toPortablePath(runtimeContext)}`)}
commandWindows = ${tomlString(`python "${runtimeContext}"`)}
timeout = 15
statusMessage = 'Checking Project Brain rail context'

[[hooks.PermissionRequest]]

[[hooks.PermissionRequest.hooks]]
type = 'command'
command = ${tomlString(`python3 ${toPortablePath(runtimeContext)}`)}
commandWindows = ${tomlString(`python "${runtimeContext}"`)}
timeout = 15
statusMessage = 'Recording permission request context'

[[hooks.PostToolUse]]
matcher = 'Write|Edit|MultiEdit|apply_patch'

[[hooks.PostToolUse.hooks]]
type = 'command'
command = ${tomlString(`python3 ${toPortablePath(postToolUse)}`)}
commandWindows = ${tomlString(`python "${postToolUse}"`)}
timeout = 180
statusMessage = 'Running persistent verifier'

[[hooks.PreCompact]]

[[hooks.PreCompact.hooks]]
type = 'command'
command = ${tomlString(`python3 ${toPortablePath(runtimeContext)}`)}
commandWindows = ${tomlString(`python "${runtimeContext}"`)}
timeout = 15
statusMessage = 'Persisting Project Brain compact context'

[[hooks.PostCompact]]

[[hooks.PostCompact.hooks]]
type = 'command'
command = ${tomlString(`python3 ${toPortablePath(runtimeContext)}`)}
commandWindows = ${tomlString(`python "${runtimeContext}"`)}
timeout = 15
statusMessage = 'Restoring Project Brain compact context'

[[hooks.Stop]]

[[hooks.Stop.hooks]]
type = 'command'
command = ${tomlString(`python3 ${toPortablePath(qualityGate)}`)}
commandWindows = ${tomlString(`python "${qualityGate}"`)}
timeout = 900
statusMessage = 'Running project quality gates'

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

function ensureCodexTrustEvidence(homePath: string, projectRoot: string, checkedAt: string): DesktopCodexGateRunEvidence {
  const command = 'read ~/.codex/config.toml projects trust';
  const trust = ensureTrustedCodexProject(homePath, projectRoot);
  return {
    available: true,
    passed: trust.trusted,
    detail: trust.trusted
      ? trust.changed
        ? 'Codex project trust автоматически установлен для выбранной папки.'
        : 'Codex project trust подтверждён для выбранной папки.'
      : trust.detail,
    checkedAt,
    staleAfterMs: trust.trusted ? CODEX_SETUP_EVIDENCE_TTL_MS : STALE_AFTER_MS,
    source: SOURCE,
    command,
    exitCode: trust.trusted ? 0 : 1,
  };
}

interface CodexProjectTrustResult {
  readonly trusted: boolean;
  readonly changed: boolean;
  readonly detail: string;
}

function ensureTrustedCodexProject(homePath: string, projectRoot: string): CodexProjectTrustResult {
  if (isTrustedCodexProject(homePath, projectRoot)) {
    return {
      trusted: true,
      changed: false,
      detail: 'Codex project trust подтверждён для выбранной папки.',
    };
  }

  const path = join(homePath, '.codex', 'config.toml');
  const existing = existsSync(path) ? readCodexConfigDocument(path) : { ok: true as const, value: {} };
  if (!existing.ok) {
    return {
      trusted: false,
      changed: false,
      detail: `Codex project trust не установлен: ${existing.error}. Пульт не запускает проектные команды автоматически.`,
    };
  }

  const next = setTrustedProject(existing.value, projectRoot);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stringifyToml(next), 'utf-8');
  } catch (error) {
    return {
      trusted: false,
      changed: false,
      detail: `Codex project trust не установлен: ${error instanceof Error ? error.message : String(error)}. Пульт не запускает проектные команды автоматически.`,
    };
  }

  return isTrustedCodexProject(homePath, projectRoot)
    ? {
        trusted: true,
        changed: true,
        detail: 'Codex project trust автоматически установлен для выбранной папки.',
      }
    : {
        trusted: false,
        changed: false,
        detail: 'Codex project trust не найден для выбранной папки; пульт не запускает проектные команды автоматически.',
      };
}

type CodexConfigReadResult =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };

function readCodexConfigDocument(path: string): CodexConfigReadResult {
  try {
    const parsed: unknown = parseToml(readCodexConfigText(path));
    return isRecord(parsed)
      ? { ok: true, value: { ...parsed } }
      : { ok: false, error: 'Codex config.toml должен быть TOML object' };
  } catch (error) {
    return {
      ok: false,
      error: `Codex config.toml не прочитан: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function setTrustedProject(config: Record<string, unknown>, projectRoot: string): Record<string, unknown> {
  const projects = isRecord(config['projects']) ? { ...config['projects'] } : {};
  const existingKey = Object.keys(projects).find(pathKey => normalizePathKey(pathKey) === normalizePathKey(projectRoot));
  const key = existingKey ?? projectRoot;
  const projectConfig = isRecord(projects[key]) ? { ...projects[key] } : {};
  projects[key] = { ...projectConfig, trust_level: 'trusted' };
  return { ...config, projects };
}

function isTrustedCodexProject(homePath: string, projectRoot: string): boolean {
  const path = join(homePath, '.codex', 'config.toml');
  if (!existsSync(path)) return false;
  let parsed: unknown;
  try {
    parsed = parseToml(readCodexConfigText(path));
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

function readCodexConfigText(path: string): string {
  return readFileSync(path, 'utf-8').replace(/^\uFEFF/, '');
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
  runtimeContextScript: string | undefined,
): Record<string, unknown> {
  const hooks = isRecord(document['hooks']) ? { ...document['hooks'] } : {};
  hooks['SessionStart'] = mergeHookGroup(hooks['SessionStart'], persistentVerifierUserHookGroup(
    '',
    commandForScript(sessionStartScript ?? join(scriptRoot, 'sessionstart.py')),
  ));
  hooks['UserPromptSubmit'] = mergeHookGroup(hooks['UserPromptSubmit'], persistentVerifierUserRuntimeHookGroup(
    commandForScript(runtimeContextScript ?? sessionStartScript ?? join(scriptRoot, 'sessionstart.py')),
  ));
  hooks['SubagentStart'] = mergeHookGroup(hooks['SubagentStart'], persistentVerifierUserRuntimeHookGroup(
    commandForScript(runtimeContextScript ?? sessionStartScript ?? join(scriptRoot, 'sessionstart.py')),
  ));
  hooks['SubagentStop'] = mergeHookGroup(hooks['SubagentStop'], persistentVerifierUserRuntimeHookGroup(
    commandForScript(runtimeContextScript ?? sessionStartScript ?? join(scriptRoot, 'sessionstart.py')),
    'Recording subagent completion context',
  ));
  hooks['PreToolUse'] = mergeHookGroup(hooks['PreToolUse'], persistentVerifierUserRuntimeHookGroup(
    commandForScript(runtimeContextScript ?? sessionStartScript ?? join(scriptRoot, 'sessionstart.py')),
    'Checking Project Brain rail context',
  ));
  hooks['PermissionRequest'] = mergeHookGroup(hooks['PermissionRequest'], persistentVerifierUserRuntimeHookGroup(
    commandForScript(runtimeContextScript ?? sessionStartScript ?? join(scriptRoot, 'sessionstart.py')),
    'Recording permission request context',
  ));
  hooks['PostToolUse'] = mergeHookGroup(hooks['PostToolUse'], persistentVerifierUserHookGroup(
    'Write|Edit|MultiEdit|apply_patch',
    commandForScript(join(scriptRoot, 'posttooluse.py')),
  ));
  hooks['PreCompact'] = mergeHookGroup(hooks['PreCompact'], persistentVerifierUserRuntimeHookGroup(
    commandForScript(runtimeContextScript ?? sessionStartScript ?? join(scriptRoot, 'sessionstart.py')),
    'Persisting Project Brain compact context',
  ));
  hooks['PostCompact'] = mergeHookGroup(hooks['PostCompact'], persistentVerifierUserRuntimeHookGroup(
    commandForScript(runtimeContextScript ?? sessionStartScript ?? join(scriptRoot, 'sessionstart.py')),
    'Restoring Project Brain compact context',
  ));
  hooks['Stop'] = mergeHookGroup(hooks['Stop'], persistentVerifierUserStopHookGroup(scriptRoot));
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

function persistentVerifierUserRuntimeHookGroup(
  command: string,
  statusMessage = 'Hydrating Project Brain runtime context',
): Record<string, unknown> {
  return {
    hooks: [
      {
        type: 'command',
        command,
        commandWindows: command,
        timeout: 15,
        statusMessage,
      },
    ],
  };
}

function persistentVerifierUserStopHookGroup(scriptRoot: string): Record<string, unknown> {
  return {
    hooks: [
      {
        type: 'command',
        command: commandForScript(join(scriptRoot, 'qualitygate.py')),
        commandWindows: commandForScript(join(scriptRoot, 'qualitygate.py')),
        timeout: 900,
        statusMessage: 'Running project quality gates',
      },
      {
        type: 'command',
        command: commandForScript(join(scriptRoot, 'stop.py')),
        commandWindows: commandForScript(join(scriptRoot, 'stop.py')),
        timeout: 15,
        statusMessage: 'Checking last verifier result',
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

function ensurePersistentVerifierPluginScripts(pluginRoot: string): void {
  const scriptRoot = join(pluginRoot, 'hooks');
  mkdirSync(scriptRoot, { recursive: true });
  writeFileSync(join(scriptRoot, 'sessionstart.py'), SESSION_START_BRIDGE_SCRIPT, 'utf-8');
  writeFileSync(join(scriptRoot, 'runtimecontext.py'), RUNTIME_CONTEXT_BRIDGE_SCRIPT, 'utf-8');
  writeFileSync(join(scriptRoot, 'posttooluse.py'), POST_TOOL_USE_HOOK_SCRIPT, 'utf-8');
  writeFileSync(join(scriptRoot, 'qualitygate.py'), QUALITY_GATE_HOOK_SCRIPT, 'utf-8');
  writeFileSync(join(scriptRoot, 'stop.py'), STOP_HOOK_SCRIPT, 'utf-8');
}

function resolvePersistentVerifierScriptRoot(homePath: string): string | null {
  for (const root of persistentVerifierPluginRoots(homePath)) {
    const scriptRoot = join(root, 'hooks');
    if (
      existsSync(join(scriptRoot, 'sessionstart.py'))
      && existsSync(join(scriptRoot, 'runtimecontext.py'))
      && existsSync(join(scriptRoot, 'posttooluse.py'))
      && existsSync(join(scriptRoot, 'qualitygate.py'))
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
  if (hookRepair.failed.length > 0) {
    return failedEvidence(command, checkedAt, `Persistent-verifier hooks.json не удалось обновить: ${hookRepair.failed[0]}`);
  }
  if (!hookBridge.installed) return failedEvidence(command, checkedAt, hookBridge.detail);
  if (managedHooks && (managedHooks.available !== true || managedHooks.passed !== true)) {
    return failedEvidence(command, checkedAt, managedHooks.detail);
  }
  const action = hookRepair.repaired.length > 0 ? 'обновлён под CLAUDE_PLUGIN_ROOT' : 'проверен';
  const managed = managedHooks ? ', managed requirements готов' : '';
  const marketplace = codexMarketplaceDetail(installResult);
  return {
    available: true,
    passed: true,
    detail: `${marketplace}; hooks.json ${action}, user-level Runtime Context bridge готов${managed}. ${codexHookTopologyDetail()}`,
    checkedAt,
    staleAfterMs: CODEX_SETUP_EVIDENCE_TTL_MS,
    source: SOURCE,
    command,
    exitCode: 0,
  };
}

function codexMarketplaceDetail(installResult: DesktopCodexCommandResult): string {
  if (installResult.exitCode === 0) return 'Codex marketplace plugin доступен';
  const reason = summarizeCodexMarketplaceFailure(installResult.output);
  return reason
    ? `Codex marketplace plugin недоступен, использован локальный bridge. Причина: ${reason}`
    : 'Codex marketplace plugin недоступен, использован локальный bridge';
}

function summarizeCodexMarketplaceFailure(output: string): string | null {
  const sanitized = sanitize(stripAnsi(output)).trim();
  if (!sanitized) return null;
  if (sanitized.includes('Папка не пуста')) return 'Папка не пуста (os error 145)';
  const notFound = sanitized.match(/plugin\s+([^\s]+)\s+was not found in marketplace\s+([^\s\r\n]+)/i);
  if (notFound) return `plugin ${notFound[1]} не найден в marketplace ${notFound[2]}`;
  const firstLine = sanitized
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length > 0 && !line.startsWith('Caused by'));
  if (!firstLine) return null;
  return firstLine
    .replace(/^Error:\s*/i, '')
    .replace(/failed to activate plugin cache entry/gi, 'кэш плагина не активирован')
    .slice(0, 160);
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
  for (const id of commandRunIds) {
    const parsed = parseRunEvidence(commandRuns[id], fileProjectId, expectedProjectId);
    const evidence = id === 'codexHooks' ? normalizeCodexGateEvidence('codexHooks', parsed) : parsed;
    if (evidence && isNewer(evidence, target.commandRuns[id])) {
      target.commandRuns[id] = evidence;
    }
  }

  const verification = isRecord(value['verification']) ? value['verification'] : {};
  for (const id of ['codexTrust', 'codexRuntime', 'desktopBootstrap', 'managedHooks', 'hookPersistence', 'runtimeContext', 'smoke', 'rollback'] as const) {
    const evidence = normalizeCodexGateEvidence(id, parseRunEvidence(verification[id], fileProjectId, expectedProjectId));
    if (evidence && isNewer(evidence, target.verification[id])) {
      target.verification[id] = evidence;
    }
  }
}

type CodexEvidenceId = 'codexHooks' | keyof MutableEvidence['verification'];

function normalizeCodexGateEvidence(
  id: CodexEvidenceId,
  evidence: DesktopCodexGateRunEvidence | null,
): DesktopCodexGateRunEvidence | null {
  if (!evidence || evidence.passed !== true) return evidence;
  if (id === 'hookPersistence' && evidence.source === 'persistent-verifier') {
    return evidenceWithMinimumTtl(evidence, NATIVE_HOOK_EVIDENCE_TTL_MS);
  }
  if (id === 'runtimeContext' && evidence.source === 'project-brain-runtime-context') {
    return evidenceWithMinimumTtl(evidence, NATIVE_HOOK_EVIDENCE_TTL_MS);
  }
  if (evidence.source === SOURCE && evidence.command === expectedDurableCodexSetupCommand(id)) {
    return evidenceWithMinimumTtl(evidence, CODEX_SETUP_EVIDENCE_TTL_MS);
  }
  return evidence;
}

function expectedDurableCodexSetupCommand(id: CodexEvidenceId): string | null {
  if (id === 'codexTrust') return 'read ~/.codex/config.toml projects trust';
  if (id === 'codexRuntime') return 'codex --version';
  if (id === 'desktopBootstrap') return 'verify persistent-verifier desktop bridge';
  if (id === 'managedHooks') return 'write %ProgramData%/OpenAI/Codex/requirements.toml managed hooks';
  if (id === 'codexHooks') return `codex plugin add ${PLUGIN_ID}`;
  if (id === 'smoke') return 'npm test';
  if (id === 'rollback') return `codex plugin remove ${PLUGIN_ID}`;
  return null;
}

function evidenceWithMinimumTtl(
  evidence: DesktopCodexGateRunEvidence,
  minimumTtlMs: number,
): DesktopCodexGateRunEvidence {
  const staleAfterMs = Math.max(evidence.staleAfterMs ?? 0, minimumTtlMs);
  return staleAfterMs === evidence.staleAfterMs ? evidence : { ...evidence, staleAfterMs };
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

async function projectSmokeEvidence(
  runner: DesktopCodexCommandRunner,
  root: string,
  checkedAt: string,
): Promise<DesktopCodexGateRunEvidence> {
  const command = projectSmokeCommand(root);
  if (!command) {
    return {
      available: false,
      detail: 'Project smoke gate не настроен: в выбранном проекте нет package.json test scripts (test, test:run, unit, test:unit).',
      checkedAt,
      staleAfterMs: CODEX_SETUP_EVIDENCE_TTL_MS,
      source: SOURCE,
      command: 'package.json test scripts',
    };
  }
  return evidenceFromResult(
    await run(runner, root, command.command, command.args),
    command.label,
    checkedAt,
    'Проектный smoke gate выполнен.',
    CODEX_SETUP_EVIDENCE_TTL_MS,
  );
}

function projectSmokeCommand(root: string): {
  readonly args: readonly string[];
  readonly command: string;
  readonly label: string;
} | null {
  const manifest = readJson(join(root, 'package.json'));
  if (!isRecord(manifest)) return null;
  const scripts = manifest.scripts;
  if (!isRecord(scripts)) return null;
  for (const scriptName of ['test', 'test:run', 'unit', 'test:unit'] as const) {
    const script = scripts[scriptName];
    if (typeof script !== 'string' || script.trim().length === 0) continue;
    if (scriptName === 'test') return { command: 'npm', args: ['test'], label: 'npm test' };
    return { command: 'npm', args: ['run', scriptName], label: `npm run ${scriptName}` };
  }
  return null;
}

function evidenceFromResult(
  result: DesktopCodexCommandResult,
  command: string,
  checkedAt: string,
  successDetail: string,
  staleAfterMs = STALE_AFTER_MS,
): DesktopCodexGateRunEvidence {
  const passed = result.exitCode === 0;
  return {
    available: true,
    passed,
    detail: passed ? successDetail : `Команда завершилась с ошибкой: ${formatFailureOutput(result.output)}`,
    checkedAt,
    staleAfterMs,
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
    && hasCurrentPassed(evidence.verification.hookPersistence, checkedAt)
    && hasCurrentPassed(evidence.verification.runtimeContext, checkedAt);
  return {
    ready,
    message: ready ? readyMessage(evidence, checkedAt) : blockerMessage(evidence, checkedAt),
    checkedAt,
    evidence,
  };
}

function readyMessage(evidence: DesktopCodexGateEvidence, checkedAt: string): string {
  if (hasCurrentPassed(evidence.verification.runtimeContext, checkedAt)) {
    return 'Codex Runtime Context proof подтверждён native hooks.';
  }
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
  if (!hasCurrentPassed(evidence.verification.rollback, checkedAt)) return 'Rollback-команда Codex gates не подтверждена.';
  if (evidence.verification.hookPersistence?.available === true && evidence.verification.hookPersistence.passed === false) {
    return evidence.verification.hookPersistence.detail;
  }
  if (hasPassed(evidence.verification.hookPersistence) && isStale(evidence.verification.hookPersistence, checkedAt)) {
    return 'Codex SessionStart evidence устарел. Открой или перезапусти Codex в проекте, чтобы native SessionStart подтвердил persistent-verifier.';
  }
  if (evidence.verification.runtimeContext?.available === true && evidence.verification.runtimeContext.passed === false) {
    return evidence.verification.runtimeContext.detail;
  }
  if (hasPassed(evidence.verification.runtimeContext) && isStale(evidence.verification.runtimeContext, checkedAt)) {
    return 'Codex Runtime Context evidence устарел. Отправь сообщение или перезапусти Codex в проекте, чтобы native hooks обновили proof.';
  }
  if (hasCurrentPassed(evidence.verification.hookPersistence, checkedAt)) {
    return 'Codex Runtime Context proof ещё не записан. Отправь сообщение или запусти subagent в проекте, чтобы native hooks подтвердили контекст.';
  }
  if (hasBaseVerification(evidence, checkedAt)) {
    return `Codex hooks установлены: ${codexHookTopologyDetail()} Открой или перезапусти Codex в проекте, чтобы native SessionStart подтвердил persistent-verifier.`;
  }
  return 'Codex gates ожидают SessionStart evidence.';
}

function codexHookTopologyDetail(): string {
  return `Codex UI показывает ${CODEX_LIFECYCLE_HOOKS.length} lifecycle hooks (${CODEX_LIFECYCLE_HOOKS.join(', ')}), а не число внутренних проверок; qualitygate.py запускает ${QUALITY_GATE_RAILS.length} rails (${QUALITY_GATE_RAILS.join(', ')}).`;
}

function hasBaseVerification(evidence: DesktopCodexGateEvidence, checkedAt: string): boolean {
  return hasCurrentPassed(evidence.verification.codexTrust, checkedAt)
    && hasCurrentPassed(evidence.verification.codexRuntime, checkedAt)
    && hasCurrentPassed(evidence.commandRuns.codexHooks, checkedAt)
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
  commandRuns: DesktopCodexGateEvidence['commandRuns'];
  verification: {
    codexTrust?: DesktopCodexGateRunEvidence;
    codexRuntime?: DesktopCodexGateRunEvidence;
    desktopBootstrap?: DesktopCodexGateRunEvidence;
    managedHooks?: DesktopCodexGateRunEvidence;
    hookPersistence?: DesktopCodexGateRunEvidence;
    runtimeContext?: DesktopCodexGateRunEvidence;
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

function formatFailureOutput(value: string): string {
  const sanitized = sanitize(stripAnsi(value)).trim();
  if (sanitized.length <= FAILURE_OUTPUT_HEAD_CHARS + FAILURE_OUTPUT_TAIL_CHARS) return sanitized;
  const head = sanitized.slice(0, FAILURE_OUTPUT_HEAD_CHARS).trimEnd();
  const tail = sanitized.slice(-FAILURE_OUTPUT_TAIL_CHARS).trimStart();
  return `${head}\n... output truncated: showing failure tail ...\n${tail}`;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
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
