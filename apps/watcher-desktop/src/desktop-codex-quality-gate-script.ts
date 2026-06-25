export const QUALITY_GATE_HOOK_SCRIPT = `#!/usr/bin/env python3
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

COMMAND_TIMEOUT_SECONDS = 10 * 60
EVIDENCE_TTL_MS = 24 * 60 * 60 * 1000
ROOT_MARKERS = (
    "package.json",
    "tsconfig.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
)
EVIDENCE_GATE_IDS = {
    "typecheck": "typecheck",
    "lint": "lint",
    "test": "test",
    "build": "build",
    "check": "check",
    "verify": "verify",
}
QUALITY_GATE_IDS = tuple(EVIDENCE_GATE_IDS.values())
QUALITY_GATE_ORDER = (
    ("typecheck", ("typecheck", "check-types", "lint:types")),
    ("lint", ("lint", "biome", "check:lint")),
    ("test", ("test", "test:run", "unit", "test:unit")),
    ("build", ("build",)),
    ("check", ("check",)),
    ("verify", ("verify", "verify-release", "verify-watcher-compatibility")),
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
    current = start if start.is_dir() else start.parent
    while True:
        if any((current / marker).exists() for marker in ROOT_MARKERS):
            return current
        if current.parent == current:
            return None
        current = current.parent


def state_path(root):
    digest = hashlib.sha1(str(root).lower().encode("utf-8")).hexdigest()
    state_dir = Path(tempfile.gettempdir()) / "persistent-verifier"
    state_dir.mkdir(parents=True, exist_ok=True)
    return state_dir / f"{digest}.json"


def write_state(root, status, summary):
    payload = {
        "root": str(root),
        "status": status,
        "summary": summary,
        "updated_at": time.time(),
    }
    state_path(root).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def command_available(command):
    return shutil.which(command) is not None


def npm_command():
    if sys.platform == "win32":
        return shutil.which("npm.cmd") or shutil.which("npm") or "npm.cmd"
    return shutil.which("npm") or shutil.which("npm.cmd") or "npm"


def npx_command():
    if sys.platform == "win32":
        return shutil.which("npx.cmd") or shutil.which("npx") or "npx.cmd"
    return shutil.which("npx") or shutil.which("npx.cmd") or "npx"


def add_once(commands, seen, name, command, canonical_command):
    key = canonical_command
    if key in seen:
        return
    seen.add(key)
    commands.append((name, command, canonical_command))


def package_commands(root):
    package_json = read_json(root / "package.json")
    scripts = package_json.get("scripts", {})
    if not isinstance(scripts, dict):
        return []
    npm = npm_command()
    commands = []
    seen = set()
    for gate_name, script_names in QUALITY_GATE_ORDER:
        for script_name in script_names:
            if script_name in scripts:
                add_once(commands, seen, gate_name, [npm, "run", script_name], f"npm run {script_name}")
                if gate_name != "verify":
                    break
    for script_name in sorted(scripts):
        if script_name.startswith("verify:"):
            add_once(commands, seen, "verify", [npm, "run", script_name], f"npm run {script_name}")
    return commands


def fallback_commands(root):
    commands = []
    seen = set()
    if (root / "tsconfig.json").exists() and command_available("npx"):
        add_once(commands, seen, "typecheck", [npx_command(), "tsc", "--noEmit", "--pretty", "false"], "npx tsc --noEmit")
    if (root / "pyproject.toml").exists():
        if command_available("ruff"):
            add_once(commands, seen, "ruff", ["ruff", "check", "."], "ruff check .")
        if command_available("pyright"):
            add_once(commands, seen, "pyright", ["pyright"], "pyright")
        if command_available("pytest"):
            add_once(commands, seen, "pytest", ["pytest"], "pytest")
    if (root / "Cargo.toml").exists() and command_available("cargo"):
        add_once(commands, seen, "cargo-check", ["cargo", "check", "--quiet"], "cargo check --quiet")
        add_once(commands, seen, "cargo-test", ["cargo", "test", "--quiet"], "cargo test --quiet")
    if (root / "go.mod").exists() and command_available("go"):
        add_once(commands, seen, "go-test", ["go", "test", "./..."], "go test ./...")
    return commands


def detect_commands(root):
    commands = package_commands(root)
    seen = {canonical_command for _, _, canonical_command in commands}
    for name, command, canonical_command in fallback_commands(root):
        add_once(commands, seen, name, command, canonical_command)
    return commands


def is_windows_shell_command(command):
    executable = str(command[0]).lower()
    return sys.platform == "win32" and (executable.endswith(".cmd") or executable.endswith(".bat"))


def run_command(name, command, canonical_command, cwd):
    started = time.time()
    use_shell = is_windows_shell_command(command)
    try:
        result = subprocess.run(
            subprocess.list2cmdline(command) if use_shell else command,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=COMMAND_TIMEOUT_SECONDS,
            check=False,
            shell=use_shell,
        )
    except Exception as exc:
        return False, f"{name}: {exc}", 1, int((time.time() - started) * 1000)

    duration_ms = int((time.time() - started) * 1000)
    combined = "\\n".join(
        line.strip()
        for line in (result.stdout or "").splitlines() + (result.stderr or "").splitlines()
        if line.strip()
    )
    excerpt = "\\n".join(combined.splitlines()[:18])
    if result.returncode == 0:
        return True, excerpt or f"{canonical_command}: OK", result.returncode, duration_ms
    if excerpt:
        return False, f"{name}:\\n{excerpt}", result.returncode, duration_ms
    return False, f"{name}: завершился с кодом {result.returncode}", result.returncode, duration_ms


def merge_command_run(existing, current):
    if not existing:
        return current
    existing_passed = bool(existing.get("passed"))
    current_passed = bool(current.get("passed"))
    passed = existing_passed and current_passed
    failed_exit_code = existing.get("exitCode") if not existing_passed else current.get("exitCode")
    return {
        "available": True,
        "passed": passed,
        "detail": "; ".join(
            item for item in (existing.get("detail"), current.get("detail"))
            if isinstance(item, str) and item
        ),
        "checkedAt": current.get("checkedAt"),
        "staleAfterMs": EVIDENCE_TTL_MS,
        "source": "quality-gate-runner",
        "command": " && ".join(
            item for item in (existing.get("command"), current.get("command"))
            if isinstance(item, str) and item
        ),
        "exitCode": 0 if passed else failed_exit_code,
        "runId": current.get("runId"),
    }


def unavailable_command_run(gate_id, checked_at):
    return {
        "available": False,
        "passed": False,
        "detail": f"{gate_id}: команда для quality rail не найдена в package scripts/fallback commands.",
        "checkedAt": checked_at,
        "staleAfterMs": EVIDENCE_TTL_MS,
        "source": "quality-gate-runner",
        "command": f"detect {gate_id}",
        "exitCode": None,
        "runId": f"{gate_id}-unavailable-{int(time.time())}",
    }


def read_project_id(root):
    config = read_json(root / ".brain" / "config.json")
    if isinstance(config, dict):
        project_id = config.get("project_id") or config.get("projectId")
        if isinstance(project_id, str) and project_id.strip():
            return project_id
    return root.name


def write_quality_evidence(root, command_runs):
    checked_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    output_dir = root / ".codex"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "quality-gate-runs.json"
    existing = read_json(output_path)
    existing_command_runs = existing.get("commandRuns") if isinstance(existing, dict) and isinstance(existing.get("commandRuns"), dict) else {}
    existing_verification = existing.get("verification") if isinstance(existing, dict) and isinstance(existing.get("verification"), dict) else {}
    merged_command_runs = {
        key: value
        for key, value in existing_command_runs.items()
        if key not in QUALITY_GATE_IDS
    }
    for gate_id in QUALITY_GATE_IDS:
        merged_command_runs[gate_id] = command_runs.get(gate_id) or unavailable_command_run(gate_id, checked_at)
    merged_command_runs.update(command_runs)
    payload = {
        "schemaVersion": 1,
        "projectId": read_project_id(root),
        "projectRoot": str(root),
        "checkedAt": checked_at,
        "staleAfterMs": EVIDENCE_TTL_MS,
        "commandRuns": merged_command_runs,
        "verification": existing_verification,
    }
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\\n",
        encoding="utf-8",
    )


def failure_message(root, failures):
    lines = [
        f"qualitygate: full quality gates не прошли в {root}",
        "",
    ]
    for failure in failures:
        lines.append(failure)
        lines.append("")
    lines.append("Исправь ошибки или запусти проектные проверки вручную перед завершением сессии.")
    return "\\n".join(lines).strip()


def main():
    input_data = read_input()
    hook_event_name = input_data.get("hookEventName") or input_data.get("hook_event_name")
    if input_data and hook_event_name not in {"Stop", "stop"}:
        succeed()
    root = find_root(input_cwd(input_data).resolve())
    if not root:
        succeed()
    commands = detect_commands(root)
    if not commands:
        write_quality_evidence(root, {})
        succeed()
    failures = []
    command_runs = {}
    for name, command, canonical_command in commands:
        ok, output, exit_code, duration_ms = run_command(name, command, canonical_command, root)
        gate_id = EVIDENCE_GATE_IDS.get(name)
        if gate_id:
            command_runs[gate_id] = merge_command_run(command_runs.get(gate_id), {
                "available": True,
                "passed": ok,
                "detail": f"{canonical_command}: exitCode={exit_code}, durationMs={duration_ms}",
                "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "staleAfterMs": EVIDENCE_TTL_MS,
                "source": "quality-gate-runner",
                "command": canonical_command,
                "exitCode": exit_code,
                "runId": f"{gate_id}-{int(time.time())}",
            })
        if not ok:
            failures.append(output)
    write_quality_evidence(root, command_runs)
    if failures:
        message = failure_message(root, failures)
        write_state(root, "failed", message)
        emit(
            {
                "decision": "block",
                "reason": "Quality gates failed",
                "systemMessage": message,
            }
        )
    summary = ", ".join(name for name, _, _ in commands)
    write_state(root, "passed", f"OK: full quality gates passed: {summary}")
    succeed()


if __name__ == "__main__":
    main()
`;
