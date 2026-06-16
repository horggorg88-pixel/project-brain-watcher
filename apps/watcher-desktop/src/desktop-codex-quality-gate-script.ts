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
ROOT_MARKERS = (
    "package.json",
    "tsconfig.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
)
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
    return shutil.which("npm") or shutil.which("npm.cmd") or "npm"


def npx_command():
    return shutil.which("npx") or shutil.which("npx.cmd") or "npx"


def add_once(commands, seen, name, command):
    key = " ".join(command)
    if key in seen:
        return
    seen.add(key)
    commands.append((name, command))


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
                add_once(commands, seen, gate_name, [npm, "run", script_name])
                if gate_name != "verify":
                    break
    for script_name in sorted(scripts):
        if script_name.startswith("verify:"):
            add_once(commands, seen, "verify", [npm, "run", script_name])
    return commands


def fallback_commands(root):
    commands = []
    seen = set()
    if (root / "tsconfig.json").exists() and command_available("npx"):
        add_once(commands, seen, "typecheck", [npx_command(), "tsc", "--noEmit", "--pretty", "false"])
    if (root / "pyproject.toml").exists():
        if command_available("ruff"):
            add_once(commands, seen, "ruff", ["ruff", "check", "."])
        if command_available("pyright"):
            add_once(commands, seen, "pyright", ["pyright"])
        if command_available("pytest"):
            add_once(commands, seen, "pytest", ["pytest"])
    if (root / "Cargo.toml").exists() and command_available("cargo"):
        add_once(commands, seen, "cargo-check", ["cargo", "check", "--quiet"])
        add_once(commands, seen, "cargo-test", ["cargo", "test", "--quiet"])
    if (root / "go.mod").exists() and command_available("go"):
        add_once(commands, seen, "go-test", ["go", "test", "./..."])
    return commands


def detect_commands(root):
    commands = package_commands(root)
    seen = {" ".join(command) for _, command in commands}
    for name, command in fallback_commands(root):
        add_once(commands, seen, name, command)
    return commands


def run_command(name, command, cwd):
    try:
        result = subprocess.run(
            command,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=COMMAND_TIMEOUT_SECONDS,
            check=False,
        )
    except Exception as exc:
        return False, f"{name}: {exc}"

    combined = "\\n".join(
        line.strip()
        for line in (result.stdout or "").splitlines() + (result.stderr or "").splitlines()
        if line.strip()
    )
    excerpt = "\\n".join(combined.splitlines()[:18])
    if result.returncode == 0:
        return True, excerpt
    if excerpt:
        return False, f"{name}:\\n{excerpt}"
    return False, f"{name}: завершился с кодом {result.returncode}"


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
        succeed()
    failures = []
    for name, command in commands:
        ok, output = run_command(name, command, root)
        if not ok:
            failures.append(output)
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
    summary = ", ".join(name for name, _ in commands)
    write_state(root, "passed", f"OK: full quality gates passed: {summary}")
    succeed()


if __name__ == "__main__":
    main()
`;
