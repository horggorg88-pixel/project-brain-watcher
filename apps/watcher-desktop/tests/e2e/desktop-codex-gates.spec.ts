import { test, expect, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { createRequire } from 'node:module';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const require = createRequire(import.meta.url);
const electronExecutable = String(require('electron'));
const appRoot = process.cwd();
const fakeBearer = 'pb_e2e_codex_token_1234567890';

test('verifies Codex settings from the real desktop control panel', async ({}, testInfo) => {
  const mcpServer = await startMockMcpServer();
  const fixture = createFixture(mcpServer.url);
  const app = await launchDesktop(fixture.homePath, fixture.userDataPath, fixture.projectRoot, fixture.fakeBinPath, fixture.programDataPath);
  const page = await app.firstWindow();
  const rendererErrors = collectRendererErrors(page);
  const mainErrors = collectMainErrors(app);

  try {
    await page.getByLabel('Почта').fill('client@example.com');
    await page.getByLabel('Пароль или барьер-ключ').fill(fakeBearer);
    await page.getByRole('button', { name: 'Войти' }).click();

    await expect(page.locator('body')).toHaveAttribute('data-access', 'signed-in');
    await expect(page.locator('[data-node="codexGates"]')).toContainText('Codex Gates');
    const codexAction = page.locator('[data-node="codexGates"] [data-check-action="verify_codex_gates"]');
    await expect(codexAction).toHaveCount(0);
    await expect(page.locator('[data-node="codexGates"]')).toContainText('Ожидает');
    await expect(page.locator('[data-node="codexGates"]')).toContainText('native SessionStart');
    await expect(codexAction).toHaveCount(0);

    const evidence = readEvidence(fixture.projectRoot);
    expect(evidence.projectId).toBe('client-project');
    expect(evidence.commandRuns?.codexHooks?.command).toBe('codex plugin add persistent-verifier@claude-migrated-home');
    expect(evidence.commandRuns?.codexHooks?.exitCode).toBe(0);
    expect(evidence.verification?.codexTrust?.command).toBe('read ~/.codex/config.toml projects trust');
    expect(evidence.verification?.desktopBootstrap?.command).toBe('verify persistent-verifier desktop bridge');
    expect(evidence.verification?.codexRuntime?.command).toBe('codex --version');
    expect(evidence.verification?.hookPersistence).toBeUndefined();
    expect(evidence.verification?.smoke?.command).toBe('npm test');
    expect(evidence.verification?.rollback?.command).toBe('codex plugin remove persistent-verifier@claude-migrated-home');
    if (process.platform === 'win32') {
      const requirementsPath = join(fixture.programDataPath, 'OpenAI', 'Codex', 'requirements.toml');
      expect(existsSync(requirementsPath)).toBe(true);
      expect(readFileSync(requirementsPath, 'utf-8')).toContain(fixture.homePath.replace(/\\/g, '\\\\'));
    }
    expect(JSON.stringify(evidence)).not.toContain(fakeBearer);
    expect(rendererErrors).toEqual([]);
    expect(mainErrors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('desktop-codex-gates.png'), fullPage: true });
  } finally {
    await app.close();
    await stopServer(mcpServer.server);
    rmSync(fixture.rootPath, { recursive: true, force: true });
  }
});

async function startMockMcpServer(): Promise<{ readonly server: Server; readonly url: string }> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const payload = parseJsonRpc(Buffer.concat(chunks).toString('utf-8'));
      response.setHeader('content-type', 'application/json');
      if (request.headers.authorization !== `Bearer ${fakeBearer}`) {
        response.writeHead(401);
        response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, error: { code: -32001, message: 'Unauthorized' } }));
        return;
      }
      if (payload.method === 'initialize') {
        response.setHeader('mcp-session-id', 'e2e-session');
        response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'mock-project-brain', version: '1.0.0' } } }));
        return;
      }
      response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: payload.method === 'tools/list' ? { tools: [] } : {} }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock MCP server did not expose a TCP port.');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function stopServer(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()));
}

function createFixture(serverUrl: string): {
  readonly fakeBinPath: string;
  readonly homePath: string;
  readonly programDataPath: string;
  readonly projectRoot: string;
  readonly rootPath: string;
  readonly userDataPath: string;
} {
  const rootPath = mkdtempSync(join(tmpdir(), 'watcher-desktop-codex-e2e-'));
  const fakeBinPath = join(rootPath, 'fake-bin');
  const homePath = join(rootPath, 'home');
  const programDataPath = join(rootPath, 'program-data');
  const userDataPath = join(rootPath, 'user-data');
  const projectRoot = join(rootPath, 'Client Project');
  mkdirSync(fakeBinPath, { recursive: true });
  mkdirSync(homePath, { recursive: true });
  mkdirSync(programDataPath, { recursive: true });
  mkdirSync(userDataPath, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  writeTrustedCodexProject(homePath, projectRoot);
  stagePersistentVerifierHookFiles(homePath);
  writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }), 'utf-8');
  writeFakeCommand(fakeBinPath, 'codex', 'codex fake ok');
  writeFakeCommand(fakeBinPath, 'npm', 'npm fake test ok');
  writeFileSync(join(userDataPath, 'project-profiles.json'), JSON.stringify([{
    id: 'client-project',
    name: 'Client Project',
    root: projectRoot,
    indexId: 'idx-client-project',
    serverUrl,
    tokenEnv: 'MCP_BEARER_TOKEN',
    createdAt: new Date(0).toISOString(),
  }], null, 2), 'utf-8');
  return { fakeBinPath, homePath, programDataPath, projectRoot, rootPath, userDataPath };
}

function writeFakeCommand(binPath: string, name: string, output: string): void {
  if (process.platform === 'win32') {
    writeFileSync(join(binPath, `${name}.cmd`), `@echo off\r\necho ${output}\r\nexit /b 0\r\n`, 'utf-8');
    return;
  }
  const commandPath = join(binPath, name);
  writeFileSync(commandPath, `#!/usr/bin/env sh\necho "${output}"\nexit 0\n`, 'utf-8');
  chmodSync(commandPath, 0o755);
}

function writeTrustedCodexProject(homePath: string, projectRoot: string): void {
  mkdirSync(join(homePath, '.codex'), { recursive: true });
  writeFileSync(join(homePath, '.codex', 'config.toml'), [
    `[projects.${JSON.stringify(projectRoot)}]`,
    'trust_level = "trusted"',
    '',
  ].join('\n'), 'utf-8');
}

async function launchDesktop(
  homePath: string,
  userDataPath: string,
  projectRoot: string,
  fakeBinPath: string,
  programDataPath: string,
): Promise<ElectronApplication> {
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  return electron.launch({
    executablePath: electronExecutable,
    args: [join(appRoot, 'dist', 'main.js')],
    env: {
      ...process.env,
      [pathKey]: `${fakeBinPath}${delimiter}${process.env[pathKey] ?? ''}`,
      HOME: homePath,
      USERPROFILE: homePath,
      ProgramData: programDataPath,
      PROGRAMDATA: programDataPath,
      MCP_BEARER_TOKEN: fakeBearer,
      PROJECT_BRAIN_DESKTOP_HOME_DIR: homePath,
      PROJECT_BRAIN_DESKTOP_USER_DATA_DIR: userDataPath,
      PROJECT_BRAIN_DESKTOP_DEBUG: '0',
      PROJECT_BRAIN_DESKTOP_DEVTOOLS: '0',
      PROJECT_BRAIN_E2E_PROJECT_ROOT: projectRoot,
    },
  });
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

function readEvidence(projectRoot: string): CodexEvidenceFile {
  return JSON.parse(readFileSync(join(projectRoot, '.brain', 'service', 'quality-gate-runs.json'), 'utf-8')) as CodexEvidenceFile;
}

function collectRendererErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

function collectMainErrors(app: ElectronApplication): string[] {
  const errors: string[] = [];
  app.process().stderr?.on('data', chunk => {
    const value = String(chunk).trim();
    if (value) errors.push(value);
  });
  return errors;
}

function parseJsonRpc(body: string): { readonly id: unknown; readonly method: string } {
  try {
    const parsed = JSON.parse(body) as { readonly id?: unknown; readonly method?: unknown };
    return { id: parsed.id ?? null, method: typeof parsed.method === 'string' ? parsed.method : '' };
  } catch {
    return { id: null, method: '' };
  }
}

interface CodexEvidenceFile {
  readonly projectId?: string;
  readonly commandRuns?: {
    readonly codexHooks?: CodexEvidenceRun;
  };
  readonly verification?: {
    readonly codexTrust?: CodexEvidenceRun;
    readonly codexRuntime?: CodexEvidenceRun;
    readonly desktopBootstrap?: CodexEvidenceRun;
    readonly hookPersistence?: CodexEvidenceRun;
    readonly rollback?: CodexEvidenceRun;
    readonly smoke?: CodexEvidenceRun;
  };
}

interface CodexEvidenceRun {
  readonly command?: string;
  readonly exitCode?: number;
}
