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
import type { DesktopCodexGateRunEvidence } from '../../apps/watcher-desktop/src/contracts.js';
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
    writeTrustedCodexProject(paths.homePath, root);
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
    const managedRequirementsPath = join(paths.homePath, 'program-data', 'OpenAI', 'Codex', 'requirements.toml');
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
      managedRequirementsPath,
    });

    expect(commands).toEqual([
      'codex --version',
      'codex plugin add persistent-verifier@claude-migrated-home',
      'codex plugin list',
      'codex features list',
      'npm test',
    ]);
    expect(result.ready).toBe(false);
    expectCodexHooksPendingMessage(result.message);
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
    expect(result.evidence.verification.desktopBootstrap).toMatchObject({
      command: 'verify persistent-verifier desktop bridge',
      exitCode: 0,
      source: 'desktop-codex-gates',
    });
    expect(result.evidence.verification.managedHooks).toMatchObject({
      passed: true,
      command: 'write %ProgramData%/OpenAI/Codex/requirements.toml managed hooks',
      source: 'desktop-codex-gates',
    });
    expect(result.evidence.verification.hookPersistence).toBeUndefined();
    expect(result.evidence.verification.runtimeContext).toBeUndefined();
    const managedRequirements = readFileSync(managedRequirementsPath, 'utf-8');
    expect(managedRequirements).toContain('project-brain-managed-hooks:start');
    expect(managedRequirements).toContain('windows_managed_dir');
    expect(managedRequirements).toContain('sessionstart.py');
    expect(managedRequirements).toContain('runtimecontext.py');
    expect(managedRequirements).toContain('UserPromptSubmit');
    expect(managedRequirements).toContain('SubagentStart');
    expect(managedRequirements).toContain('posttooluse.py');
    expect(managedRequirements).toContain('qualitygate.py');
    expect(managedRequirements).toContain('stop.py');
    const pluginHooks = readFileSync(join(
      paths.homePath,
      '.codex',
      'plugins',
      'cache',
      'claude-migrated-home',
      'persistent-verifier',
      '0.1.0',
      'hooks.json',
    ), 'utf-8');
    expect(pluginHooks).toContain('${CLAUDE_PLUGIN_ROOT}');
    expect(pluginHooks).not.toContain('%PLUGIN_ROOT%');
    expect(pluginHooks).not.toContain('${PLUGIN_ROOT}');
    expect(pluginHooks).toContain('commandWindows');
    expect(pluginHooks).not.toContain('command_windows');
    expect(pluginHooks).not.toContain('"description"');
    const userHooks = readFileSync(join(paths.homePath, '.codex', 'hooks.json'), 'utf-8');
    expect(userHooks).toContain('persistent-verifier');
    expect(userHooks).toContain('project-brain-hooks');
    expect(userHooks).toContain('Write|Edit|MultiEdit|apply_patch');
    expect(userHooks).toContain('sessionstart.py');
    expect(userHooks).toContain('runtimecontext.py');
    expect(userHooks).toContain('UserPromptSubmit');
    expect(userHooks).toContain('SubagentStart');
    expect(userHooks).toContain('qualitygate.py');
    expect(pluginHooks).toContain('qualitygate.py');
    expect(pluginHooks).toContain('Write|Edit|MultiEdit|apply_patch');
    const bridgeScript = readFileSync(join(paths.homePath, '.codex', 'project-brain-hooks', 'sessionstart.py'), 'utf-8');
    expect(bridgeScript).toContain('registry_projects');
    expect(bridgeScript).toContain('def succeed()');
    expect(bridgeScript).toContain('succeed()');
    expect(bridgeScript).toContain('runtime-context.json');
    expect(bridgeScript).toContain('runtimeContext');
    expect(bridgeScript).not.toContain('emit({})');
    expect(bridgeScript).not.toContain('emit({"projects":');
    const runtimeContextScript = readFileSync(join(paths.homePath, '.codex', 'project-brain-hooks', 'runtimecontext.py'), 'utf-8');
    expect(runtimeContextScript).toContain('UserPromptSubmit');
    expect(runtimeContextScript).toContain('SubagentStart');
    const registry = JSON.parse(readFileSync(join(paths.homePath, '.codex', 'project-brain-hooks', 'sessionstart-projects.json'), 'utf-8')) as {
      readonly projects: readonly { readonly root: string }[];
    };
    expect(registry.projects.map(project => project.root)).toContain(root);
    expect(JSON.stringify(result.evidence)).not.toContain('pb_secret_value');
    const qualityGateScript = readFileSync(join(paths.homePath, 'plugins', 'persistent-verifier', 'hooks', 'qualitygate.py'), 'utf-8');
    expect(qualityGateScript).toContain('QUALITY_GATE_ORDER');
    expect(qualityGateScript).toContain('("test",');
    expect(qualityGateScript).toContain('("build",');
    expect(qualityGateScript).toContain('return shutil.which("npm.cmd") or shutil.which("npm") or "npm.cmd"');
    expect(qualityGateScript).toContain('return shutil.which("npx.cmd") or shutil.which("npx") or "npx.cmd"');
    expect(qualityGateScript).toContain('seen = {canonical_command for _, _, canonical_command in commands}');
    expect(qualityGateScript).toContain('shell=use_shell');
  });

  it('preserves existing Codex user hooks while installing the persistent-verifier bridge', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    mkdirSync(root, { recursive: true });
    writeTrustedCodexProject(paths.homePath, root);
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

    const verifyOptions = {
      runner: async () => ({ exitCode: 0, output: 'ok' }),
      now: () => new Date('2026-06-15T10:00:00.000Z'),
    };
    await verifyDesktopCodexGates(paths, 'demo-project', verifyOptions);
    await verifyDesktopCodexGates(paths, 'demo-project', verifyOptions);

    const userHooks = readFileSync(join(paths.homePath, '.codex', 'hooks.json'), 'utf-8');
    expect(userHooks).toContain('python existing.py');
    expect(userHooks).toContain('persistent-verifier');
    const parsedHooks = JSON.parse(userHooks) as {
      readonly hooks: {
        readonly SessionStart: readonly unknown[];
        readonly UserPromptSubmit: readonly unknown[];
      };
    };
    expect(parsedHooks.hooks.SessionStart).toHaveLength(1);
    expect(parsedHooks.hooks.UserPromptSubmit).toHaveLength(2);
  });

  it('bootstraps local persistent-verifier hooks when marketplace hook files are missing', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    mkdirSync(root, { recursive: true });
    writeTrustedCodexProject(paths.homePath, root);
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
    expectCodexHooksPendingMessage(result.message);
    expect(result.evidence.commandRuns.codexHooks).toMatchObject({
      passed: true,
      exitCode: 0,
    });
    expect(readFileSync(join(paths.homePath, 'plugins', 'persistent-verifier', 'hooks', 'posttooluse.py'), 'utf-8')).toContain('tool_name');
    expect(readFileSync(join(paths.homePath, 'plugins', 'persistent-verifier', 'hooks', 'stop.py'), 'utf-8')).toContain('Verifier still failing');
  });

  it('keeps Codex hooks ready when the marketplace plugin is not found but local bridge is installed', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    mkdirSync(root, { recursive: true });
    writeTrustedCodexProject(paths.homePath, root);
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
      runner: async request => {
        if ([request.command, ...request.args].join(' ') === 'codex plugin add persistent-verifier@claude-migrated-home') {
          return {
            exitCode: 1,
            output: 'Error: plugin persistent-verifier was not found in marketplace claude-migrated-home',
          };
        }
        return { exitCode: 0, output: 'ok' };
      },
      now: () => new Date('2026-06-15T10:00:00.000Z'),
    });

    expect(result.ready).toBe(false);
    expectCodexHooksPendingMessage(result.message);
    expect(result.evidence.commandRuns.codexHooks).toMatchObject({
      passed: true,
      exitCode: 0,
    });
    expect(result.evidence.commandRuns.codexHooks?.detail).toContain('marketplace plugin недоступен');
    expect(result.evidence.verification.desktopBootstrap).toMatchObject({
      passed: true,
      command: 'verify persistent-verifier desktop bridge',
    });
  });

  it('installs Codex project trust before running project commands', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    mkdirSync(root, { recursive: true });
    stagePersistentVerifierHookFiles(paths.homePath);
    saveProfile(paths, {
      id: 'demo-project',
      name: 'Demo Project',
      root,
      indexId: 'idx-demo-project',
      serverUrl: 'http://149.33.14.250',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });
    const commands: string[] = [];

    const result = await verifyDesktopCodexGates(paths, 'demo-project', {
      runner: async request => {
        commands.push([request.command, ...request.args].join(' '));
        return { exitCode: 0, output: 'ok' };
      },
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
    expectCodexHooksPendingMessage(result.message);
    expect(result.evidence.verification.codexTrust).toMatchObject({
      passed: true,
      detail: 'Codex project trust автоматически установлен для выбранной папки.',
      command: 'read ~/.codex/config.toml projects trust',
    });
    expect(readFileSync(join(paths.homePath, '.codex', 'config.toml'), 'utf-8')).toContain('trust_level = "trusted"');
  });

  it('does not run project commands when Codex config cannot be parsed safely', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    mkdirSync(join(paths.homePath, '.codex'), { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(join(paths.homePath, '.codex', 'config.toml'), '[projects."broken"\n', 'utf-8');
    stagePersistentVerifierHookFiles(paths.homePath);
    saveProfile(paths, {
      id: 'demo-project',
      name: 'Demo Project',
      root,
      indexId: 'idx-demo-project',
      serverUrl: 'http://149.33.14.250',
      tokenEnv: 'MCP_BEARER_TOKEN',
    });
    const commands: string[] = [];

    const result = await verifyDesktopCodexGates(paths, 'demo-project', {
      runner: async request => {
        commands.push([request.command, ...request.args].join(' '));
        return { exitCode: 0, output: 'ok' };
      },
      now: () => new Date('2026-06-15T10:00:00.000Z'),
    });

    expect(commands).toEqual([]);
    expect(result.ready).toBe(false);
    expect(result.message).toContain('Codex project trust не установлен: Codex config.toml не прочитан');
    expect(result.evidence.verification.codexTrust).toMatchObject({
      passed: false,
      command: 'read ~/.codex/config.toml projects trust',
    });
  });

  it('keeps an existing Codex MCP server config when auto-installing project trust', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    mkdirSync(join(paths.homePath, '.codex'), { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(join(paths.homePath, '.codex', 'config.toml'), [
      '[mcp_servers.project-brain]',
      'bearer_token_env_var = "MCP_BEARER_TOKEN"',
      'url = "http://149.33.14.250/mcp/p/demo-project"',
      '',
    ].join('\n'), 'utf-8');
    stagePersistentVerifierHookFiles(paths.homePath);
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

    const config = readFileSync(join(paths.homePath, '.codex', 'config.toml'), 'utf-8');
    expect(result.evidence.verification.codexTrust).toMatchObject({
      passed: true,
      detail: 'Codex project trust автоматически установлен для выбранной папки.',
    });
    expect(config).toContain('[mcp_servers.project-brain]');
    expect(config).toContain('url = "http://149.33.14.250/mcp/p/demo-project"');
    expect(config).toContain('trust_level = "trusted"');
  });

  it('accepts a Codex config that starts with a UTF-8 BOM before auto-installing project trust', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    mkdirSync(join(paths.homePath, '.codex'), { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(join(paths.homePath, '.codex', 'config.toml'), [
      '\uFEFFmodel = "gpt-5.5"',
      'model_reasoning_effort = "high"',
      '',
    ].join('\n'), 'utf-8');
    stagePersistentVerifierHookFiles(paths.homePath);
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

    const config = readFileSync(join(paths.homePath, '.codex', 'config.toml'), 'utf-8');
    expect(result.evidence.verification.codexTrust).toMatchObject({
      passed: true,
      detail: 'Codex project trust автоматически установлен для выбранной папки.',
    });
    expect(config).toContain('model = "gpt-5.5"');
    expect(config).toContain('model_reasoning_effort = "high"');
    expect(config).toContain('trust_level = "trusted"');
  });

  it('surfaces the failing smoke command reason instead of a generic pending message', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    mkdirSync(root, { recursive: true });
    writeTrustedCodexProject(paths.homePath, root);
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

    const result = await verifyDesktopCodexGates(paths, 'demo-project', {
      runner: async request => {
        const command = [request.command, ...request.args].join(' ');
        if (command === 'npm test') {
          return {
            exitCode: 1,
            output: 'FAIL tests/runtime-start/app-version.test.ts TOKEN=pb_secret_value expected v1.4.66 received v1.4.65',
          };
        }
        return { exitCode: 0, output: 'ok' };
      },
      now: () => new Date('2026-06-15T10:00:00.000Z'),
    });

    expect(result.ready).toBe(false);
    expect(result.message).toContain('Smoke gate Codex упал');
    expect(result.message).toContain('tests/runtime-start/app-version.test.ts');
    expect(result.message).toContain('TOKEN=[redacted]');
    expect(result.message).not.toContain('pb_secret_value');
  });

  it('keeps the failing smoke tail when vitest writes a long green header first', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    mkdirSync(root, { recursive: true });
    writeTrustedCodexProject(paths.homePath, root);
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

    const greenHeader = [
      '> lbsbonus-monolit@1.0.0 test',
      '> vitest run',
      '',
      'RUN v4.1.8 C:/Users/salim/go/src/LBS_Bonus',
      ...Array.from({ length: 18 }, (_, index) => `✓ tests/rebrand-inventory-validator.test.js (${index + 1})`),
    ].join('\n');
    const failureTail = [
      'FAIL tests/sql-admin-remaining-endpoint-retirement-contract.test.js',
      'AssertionError: expected retired endpoint to return 410',
      'Expected: 410',
      'Received: 200',
    ].join('\n');
    const result = await verifyDesktopCodexGates(paths, 'demo-project', {
      runner: async request => {
        const command = [request.command, ...request.args].join(' ');
        if (command === 'npm test') return { exitCode: 1, output: `${greenHeader}\n${failureTail}` };
        return { exitCode: 0, output: 'ok' };
      },
      now: () => new Date('2026-06-15T10:00:00.000Z'),
    });

    expect(result.ready).toBe(false);
    expect(result.message).toContain('Smoke gate Codex упал');
    expect(result.message).toContain('FAIL tests/sql-admin-remaining-endpoint-retirement-contract.test.js');
    expect(result.message).toContain('Received: 200');
  });

  it('reads native hook persistence evidence written by Codex hooks', () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    const setupCheckedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const nativeCheckedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
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
      commandRuns: {
        codexHooks: passedRun('Codex persistent-verifier plugin установлен.', 'desktop-codex-gates', 'codex plugin add persistent-verifier@claude-migrated-home', setupCheckedAt),
      },
      verification: {
        codexTrust: passedRun('Codex project trust подтверждён.', 'desktop-codex-gates', 'read ~/.codex/config.toml projects trust', setupCheckedAt),
        codexRuntime: passedRun('Codex CLI проверен.', 'desktop-codex-gates', 'codex --version', setupCheckedAt),
        hookPersistence: {
          available: true,
          passed: true,
          detail: 'Codex SessionStart hook loaded persistent-verifier.',
          checkedAt: nativeCheckedAt,
          staleAfterMs: 600000,
          source: 'persistent-verifier',
          command: 'codex features list',
          exitCode: 0,
          runId: 'hookPersistence-1',
        },
        runtimeContext: {
          available: true,
          passed: true,
          detail: 'Codex Runtime Context proof recorded by native UserPromptSubmit hook.',
          checkedAt: nativeCheckedAt,
          staleAfterMs: 600000,
          source: 'project-brain-runtime-context',
          command: 'project-brain runtime context proof',
          exitCode: 0,
          runId: 'runtimeContext-1',
        },
        smoke: passedRun('Проектный smoke gate выполнен.', 'desktop-codex-gates', 'npm test', setupCheckedAt),
        rollback: passedRun('Rollback-команда доступна.', 'desktop-codex-gates', 'codex plugin remove persistent-verifier@claude-migrated-home', setupCheckedAt),
      },
    }), 'utf-8');

    const result = readDesktopCodexGateEvidence(paths, 'demo-project');

    expect(result.ready).toBe(true);
    expect(result.message).toBe('Codex Runtime Context proof подтверждён native hooks.');
    expect(result.evidence.verification.hookPersistence).toMatchObject({
      command: 'codex features list',
      exitCode: 0,
      source: 'persistent-verifier',
      staleAfterMs: 86_400_000,
    });
    expect(result.evidence.verification.runtimeContext).toMatchObject({
      command: 'project-brain runtime context proof',
      exitCode: 0,
      source: 'project-brain-runtime-context',
      staleAfterMs: 86_400_000,
    });
    expect(result.evidence.commandRuns.codexHooks).toMatchObject({
      command: 'codex plugin add persistent-verifier@claude-migrated-home',
      staleAfterMs: 86_400_000,
    });
    expect(result.evidence.verification.codexRuntime).toMatchObject({
      command: 'codex --version',
      staleAfterMs: 86_400_000,
    });
    expect(result.evidence.verification.smoke).toMatchObject({
      command: 'npm test',
      staleAfterMs: 86_400_000,
    });
    expect(result.evidence.verification.rollback).toMatchObject({
      command: 'codex plugin remove persistent-verifier@claude-migrated-home',
      staleAfterMs: 86_400_000,
    });
  });

  it('keeps Codex gates pending when runtime context proof is missing', () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    const checkedAt = new Date().toISOString();
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
      commandRuns: {
        codexHooks: passedRun('Codex persistent-verifier plugin установлен.', 'desktop-codex-gates', 'codex plugin add persistent-verifier@claude-migrated-home', checkedAt),
      },
      verification: {
        codexTrust: passedRun('Codex project trust подтверждён.', 'desktop-codex-gates', 'read ~/.codex/config.toml projects trust', checkedAt),
        codexRuntime: passedRun('Codex CLI проверен.', 'desktop-codex-gates', 'codex --version', checkedAt),
        hookPersistence: {
          available: true,
          passed: true,
          detail: 'Codex SessionStart hook loaded persistent-verifier.',
          checkedAt,
          staleAfterMs: 600000,
          source: 'persistent-verifier',
          command: 'codex features list',
          exitCode: 0,
          runId: 'hookPersistence-1',
        },
        smoke: passedRun('Проектный smoke gate выполнен.', 'desktop-codex-gates', 'npm test', checkedAt),
        rollback: passedRun('Rollback-команда доступна.', 'desktop-codex-gates', 'codex plugin remove persistent-verifier@claude-migrated-home', checkedAt),
      },
    }), 'utf-8');

    const result = readDesktopCodexGateEvidence(paths, 'demo-project');

    expect(result.ready).toBe(false);
    expect(result.message).toBe('Codex Runtime Context proof ещё не записан. Отправь сообщение или запусти subagent в проекте, чтобы native hooks подтвердили контекст.');
  });

  it('does not accept stale native hook persistence evidence as ready', () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    const checkedAt = new Date().toISOString();
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
      commandRuns: {
        codexHooks: passedRun('Codex persistent-verifier plugin установлен.', 'desktop-codex-gates', 'codex plugin add persistent-verifier@claude-migrated-home', checkedAt),
      },
      verification: {
        codexTrust: passedRun('Codex project trust подтверждён.', 'desktop-codex-gates', 'read ~/.codex/config.toml projects trust', checkedAt),
        codexRuntime: passedRun('Codex CLI проверен.', 'desktop-codex-gates', 'codex --version', checkedAt),
        hookPersistence: {
          available: true,
          passed: true,
          detail: 'Codex SessionStart hook loaded persistent-verifier.',
          checkedAt: '2000-01-01T00:00:00.000Z',
          staleAfterMs: 600000,
          source: 'persistent-verifier',
          command: 'codex features list',
          exitCode: 0,
          runId: 'hookPersistence-stale',
        },
        smoke: passedRun('Проектный smoke gate выполнен.', 'desktop-codex-gates', 'npm test', checkedAt),
        rollback: passedRun('Rollback-команда доступна.', 'desktop-codex-gates', 'codex plugin remove persistent-verifier@claude-migrated-home', checkedAt),
      },
    }), 'utf-8');

    const result = readDesktopCodexGateEvidence(paths, 'demo-project');

    expect(result.ready).toBe(false);
    expect(result.message).toBe('Codex SessionStart evidence устарел. Открой или перезапусти Codex в проекте, чтобы native SessionStart подтвердил persistent-verifier.');
  });

  it('keeps Codex gates pending until native SessionStart hook evidence exists', async () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    mkdirSync(root, { recursive: true });
    writeTrustedCodexProject(paths.homePath, root);
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
    expectCodexHooksPendingMessage(result.message);
    expect(result.evidence.verification.desktopBootstrap).toMatchObject({
      passed: true,
      source: 'desktop-codex-gates',
    });
    expect(result.evidence.verification.desktopBootstrap?.detail).toContain('5 lifecycle hooks');
    expect(result.evidence.verification.desktopBootstrap?.detail).toContain('6 rails');
    expect(result.evidence.verification.hookPersistence).toBeUndefined();
    expect(result.evidence.verification.runtimeContext).toBeUndefined();
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

  it('reads durable project command gate evidence written by native hooks', () => {
    const paths = tempPaths();
    const root = join(paths.homePath, 'demo-project');
    const checkedAt = new Date().toISOString();
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
      commandRuns: {
        codexHooks: passedRun('Codex persistent-verifier plugin установлен.', 'desktop-codex-gates', 'codex plugin add persistent-verifier@claude-migrated-home', checkedAt),
        typecheck: passedRun('Typecheck passed from native qualitygate hook.', 'quality-gate-runner', 'npm run typecheck', checkedAt),
      },
    }), 'utf-8');

    const result = readDesktopCodexGateEvidence(paths, 'demo-project');

    expect(result.evidence.commandRuns.typecheck).toMatchObject({
      command: 'npm run typecheck',
      exitCode: 0,
      source: 'quality-gate-runner',
    });
    expect(result.evidence.commandRuns.codexHooks).toMatchObject({
      command: 'codex plugin add persistent-verifier@claude-migrated-home',
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

function writeTrustedCodexProject(homePath: string, root: string): void {
  mkdirSync(join(homePath, '.codex'), { recursive: true });
  writeFileSync(join(homePath, '.codex', 'config.toml'), [
    `[projects.${JSON.stringify(root)}]`,
    'trust_level = "trusted"',
    '',
  ].join('\n'), 'utf-8');
}

function passedRun(
  detail: string,
  source: string,
  command: string,
  checkedAt = '2026-06-15T10:00:00.000Z',
): DesktopCodexGateRunEvidence {
  return {
    available: true,
    passed: true,
    detail,
    checkedAt,
    staleAfterMs: 600000,
    source,
    command,
    exitCode: 0,
  };
}

function expectCodexHooksPendingMessage(message: string): void {
  expect(message).toContain('Codex hooks установлены');
  expect(message).toContain('5 lifecycle hooks');
  expect(message).toContain('6 rails');
  expect(message).toContain('native SessionStart');
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
