import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readDesktopCodexGateEvidence,
  resolveCodexGateExecutable,
  resolveCodexGateSpawn,
  verifyDesktopCodexGates,
  type DesktopCodexCommandRunner,
} from '../../apps/watcher-desktop/src/desktop-codex-gates.js';
import { saveProfile, type DesktopCorePaths } from '../../apps/watcher-desktop/src/desktop-core.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('watcher desktop codex gates', () => {
  it('runs the local Codex verifier setup and returns redacted evidence', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    mkdirSync(root, { recursive: true });
    stagePersistentVerifierHookFiles(paths.homePath);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }), 'utf-8');
    saveProfile(paths, {
      id: 'demo-project',
      name: 'Demo Project',
      root,
      indexId: 'idx-demo-project',
      serverUrl: 'http://149.33.14.250',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });
    const commands: string[] = [];
    const runner: DesktopCodexCommandRunner = async request => {
      commands.push([request.command, ...request.args].join(' '));
      return {
        exitCode: 0,
        output: request.args.includes('test') ? 'ok TOKEN=pb_secret_value' : 'ok',
      };
    };

    const result = await verifyDesktopCodexGates(paths, 'demo-project', {
      runner,
      now: () => new Date('2026-06-15T10:00:00.000Z'),
    });

    expect(commands).toEqual([
      'codex --version',
      'codex plugin add persistent-verifier@claude-migrated-home',
      'codex plugin list',
      'codex features list',
      'npm test',
    ]);
    expect(result.ready).toBe(false);
    expect(result.message).toBe('Codex hooks установлены. Открой Codex в проекте и доверь hooks через /hooks, чтобы SessionStart подтвердил persistent-verifier.');
    expect(result.evidence.commandRuns.codexHooks).toMatchObject({
      command: 'codex plugin add persistent-verifier@claude-migrated-home',
      exitCode: 0,
      source: 'desktop-codex-gates',
    });
    expect(result.evidence.verification.codexRuntime).toMatchObject({
      command: 'codex --version',
      exitCode: 0,
    });
    expect(result.evidence.verification.smoke).toMatchObject({
      command: 'npm test',
      exitCode: 0,
    });
    expect(result.evidence.verification.rollback).toMatchObject({
      command: 'codex plugin remove persistent-verifier@claude-migrated-home',
      exitCode: 0,
    });
    expect(readFileSync(join(
      paths.homePath,
      '.codex',
      'plugins',
      'cache',
      'claude-migrated-home',
      'persistent-verifier',
      '0.1.0',
      'hooks.json',
    ), 'utf-8')).toContain('%PLUGIN_ROOT%');
    expect(readFileSync(join(paths.homePath, '.codex', 'hooks.json'), 'utf-8')).toContain('persistent-verifier');
    expect(readFileSync(join(paths.homePath, '.codex', 'hooks.json'), 'utf-8')).toContain('sessionstart.py');
    expect(JSON.stringify(result.evidence)).not.toContain('pb_secret_value');
  });

  it('preserves existing Codex user hooks while installing the persistent-verifier bridge', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    mkdirSync(root, { recursive: true });
    stagePersistentVerifierHookFiles(paths.homePath);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }), 'utf-8');
    mkdirSync(join(paths.homePath, '.codex'), { recursive: true });
    writeFileSync(join(paths.homePath, '.codex', 'hooks.json'), JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'python existing.py' }] }],
      },
    }, null, 2), 'utf-8');
    saveProfile(paths, {
      id: 'demo-project',
      name: 'Demo Project',
      root,
      indexId: 'idx-demo-project',
      serverUrl: 'http://149.33.14.250',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });

    await verifyDesktopCodexGates(paths, 'demo-project', {
      runner: async () => ({ exitCode: 0, output: 'ok' }),
      now: () => new Date('2026-06-15T10:00:00.000Z'),
    });

    const userHooks = readFileSync(join(paths.homePath, '.codex', 'hooks.json'), 'utf-8');
    expect(userHooks).toContain('python existing.py');
    expect(userHooks).toContain('persistent-verifier');
  });

  it('blocks Codex hook setup when persistent-verifier hook files are missing', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }), 'utf-8');
    saveProfile(paths, {
      id: 'demo-project',
      name: 'Demo Project',
      root,
      indexId: 'idx-demo-project',
      serverUrl: 'http://149.33.14.250',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });

    const result = await verifyDesktopCodexGates(paths, 'demo-project', {
      runner: async () => ({ exitCode: 0, output: 'ok' }),
      now: () => new Date('2026-06-15T10:00:00.000Z'),
    });

    expect(result.ready).toBe(false);
    expect(result.message).toBe('Persistent-verifier plugin ещё не установлен или не прошёл проверку.');
    expect(result.evidence.commandRuns.codexHooks).toMatchObject({
      passed: false,
      exitCode: 1,
    });
  });

  it('reads native hook persistence evidence written by Codex hooks', () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    mkdirSync(join(root, '.codex'), { recursive: true });
    saveProfile(paths, {
      id: 'demo-project',
      name: 'Demo Project',
      root,
      indexId: 'idx-demo-project',
      serverUrl: 'http://149.33.14.250',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });
    writeFileSync(join(root, '.codex', 'quality-gate-runs.json'), JSON.stringify({
      schemaVersion: 1,
      projectId: 'demo-project',
      verification: {
        hookPersistence: {
          available: true,
          passed: true,
          detail: 'Codex SessionStart hook loaded persistent-verifier.',
          checkedAt: '2026-06-15T10:00:00.000Z',
          staleAfterMs: 600000,
          source: 'persistent-verifier',
          command: 'codex features list',
          exitCode: 0,
          runId: 'hookPersistence-1',
        },
      },
    }), 'utf-8');

    const result = readDesktopCodexGateEvidence(paths, 'demo-project');

    expect(result.ready).toBe(true);
    expect(result.evidence.verification.hookPersistence).toMatchObject({
      command: 'codex features list',
      exitCode: 0,
      source: 'persistent-verifier',
    });
  });

  it('keeps Codex gates pending until native SessionStart hook evidence exists', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    mkdirSync(root, { recursive: true });
    stagePersistentVerifierHookFiles(paths.homePath);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }), 'utf-8');
    saveProfile(paths, {
      id: 'demo-project',
      name: 'Demo Project',
      root,
      indexId: 'idx-demo-project',
      serverUrl: 'http://149.33.14.250',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });
    const runner: DesktopCodexCommandRunner = async () => ({ exitCode: 0, output: 'ok' });

    const result = await verifyDesktopCodexGates(paths, 'demo-project', {
      runner,
      now: () => new Date('2026-06-15T10:00:00.000Z'),
    });

    expect(result.ready).toBe(false);
    expect(result.message).toBe('Codex hooks установлены. Открой Codex в проекте и доверь hooks через /hooks, чтобы SessionStart подтвердил persistent-verifier.');
    expect(result.evidence.verification.hookPersistence).toBeUndefined();
  });

  it('uses Windows command shims for Codex CLI and npm gates', () => {
    expect(resolveCodexGateExecutable('codex', 'win32')).toBe('codex.cmd');
    expect(resolveCodexGateExecutable('npm', 'win32')).toBe('npm.cmd');
    expect(resolveCodexGateExecutable('git', 'win32')).toBe('git');
    expect(resolveCodexGateExecutable('codex', 'linux')).toBe('codex');
    expect(resolveCodexGateSpawn('codex', ['plugin', 'add', 'persistent-verifier@claude-migrated-home'], 'win32')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'codex.cmd', 'plugin', 'add', 'persistent-verifier@claude-migrated-home'],
    });
  });
});

function tempPaths(): DesktopCorePaths {
  const root = mkdtempSync(join(tmpdir(), 'watcher-desktop-codex-gates-'));
  tempDirs.push(root);
  return {
    homePath: join(root, 'home'),
    userDataPath: join(root, 'user-data'),
  };
}

function stagePersistentVerifierHookFiles(homePath: string): void {
  const scriptDir = join(homePath, 'plugins', 'persistent-verifier', 'hooks');
  mkdirSync(scriptDir, { recursive: true });
  for (const name of ['sessionstart.py', 'posttooluse.py', 'stop.py']) {
    writeFileSync(join(scriptDir, name), 'print("{}")\n', 'utf-8');
  }
  for (const hooksPath of [
    join(homePath, 'plugins', 'persistent-verifier', 'hooks.json'),
    join(homePath, '.codex', 'plugins', 'cache', 'claude-migrated-home', 'persistent-verifier', '0.1.0', 'hooks.json'),
  ]) {
    mkdirSync(join(hooksPath, '..'), { recursive: true });
    writeFileSync(hooksPath, JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'python ./hooks/sessionstart.py', timeout: 15 }] }],
        PostToolUse: [{
          matcher: 'Write|Edit|MultiEdit',
          hooks: [{ type: 'command', command: 'python ./hooks/posttooluse.py', timeout: 180 }],
        }],
        Stop: [{ hooks: [{ type: 'command', command: 'python ./hooks/stop.py', timeout: 15 }] }],
      },
    }, null, 2), 'utf-8');
  }
}
