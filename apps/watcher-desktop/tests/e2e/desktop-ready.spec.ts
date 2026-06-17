import { test, expect, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const electronExecutable = String(require('electron'));
const appRoot = process.cwd();
const fakeBearer = 'pb_e2e_ready_token_1234567890';
const readyProjectId = 'ready-e2e-project';
test('clicks through the desktop control panel until the selected project is fully ready', async ({}, testInfo) => {
  const mcpServer = await startMockMcpServer();
  const fixture = createReadyFixture(mcpServer.url);
  const app = await launchDesktop(fixture.userDataPath);
  const page = await app.firstWindow();
  const rendererErrors = collectRendererErrors(page);
  const mainErrors = collectMainErrors(app);

  try {
    await expect(page.locator('[data-login-screen]')).toBeVisible();
    await page.getByLabel('Почта').fill('client@example.com');
    await page.getByLabel('Пароль или барьер-ключ').fill(fakeBearer);
    await page.getByRole('button', { name: 'Войти' }).click();

    await expect(page.locator('body')).toHaveAttribute('data-access', 'signed-in');
    await expect(page.locator('body')).toHaveAttribute('data-server-verified', 'true');
    await page.locator('[data-project-select-button]').click();
    await page.locator(`[data-project-option="${readyProjectId}"]`).click();
    await page.getByRole('button', { name: 'Проверить подключение' }).click();

    await expect(page.locator('[data-overall-status]')).toHaveText('Подключение готово');
    await expect(page.locator('[data-connection-cause]')).toHaveText('Причина: контур MCP готов');
    await expect(page.locator('[data-checklist] [data-status="active"]')).toHaveCount(7);
    await expect(page.locator('[data-check-action]')).toHaveCount(0);
    await expect(page.locator('[data-node="codexTrust"]')).toContainText('Codex project trust подтверждён.');
    await expect(page.locator('[data-node="codexGates"]')).toContainText('Codex Runtime Context proof подтверждён native hooks.');
    await expect(page.locator('[data-node="watcher"]')).toContainText('Watcher работает');
    await page.screenshot({ path: testInfo.outputPath('desktop-ready-overview.png'), fullPage: true });
    await page.getByRole('button', { name: 'Промт' }).click();
    await page.locator('[data-copy-prompt]').click();
    await expect(page.locator('[data-service-output]')).toContainText('Стартовый prompt скопирован');
    expect(await readClipboard(app)).toContain(`brain_status(project_id="${readyProjectId}"`);
    await page.getByRole('button', { name: 'Режимы' }).click();
    await page.locator('[data-mode-step="next"]').click();
    await page.locator('[data-mode-select]').selectOption({ index: 0 });
    await expect(page.locator('[data-modes]')).toContainText('Когда применять');

    await page.getByRole('button', { name: 'Watcher' }).click();
    await expect(page.locator('[data-service-summary]')).toHaveText('Watcher работает');
    await expect(page.locator('[data-service-action="stop"]')).toBeVisible();
    await expect(page.locator('[data-service-action="restart"]')).toBeVisible();
    await expect(page.locator('[data-service-action="install"]')).toBeHidden();
    await page.locator('[data-copy-service-logs]').click();
    await expect(page.locator('[data-service-output]')).toContainText('Логи службы скопированы');
    await page.screenshot({ path: testInfo.outputPath('desktop-ready-watcher.png'), fullPage: true });

    await page.getByRole('button', { name: 'Проекты' }).click();
    await expect(page.locator('[data-project-form] input[name="id"]')).toHaveValue(readyProjectId);
    await page.locator('[data-toggle-theme]').click();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark');
    await page.locator('[data-toggle-theme]').click();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasHorizontalOverflow).toBe(false);
    expect(rendererErrors).toEqual([]);
    expect(mainErrors).toEqual([]);
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

function createReadyFixture(serverUrl: string): { readonly rootPath: string; readonly userDataPath: string } {
  const rootPath = mkdtempSync(join(tmpdir(), 'watcher-desktop-ready-e2e-'));
  const userDataPath = join(rootPath, 'user-data');
  const projectRoot = join(rootPath, 'MCP');
  mkdirSync(userDataPath, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(join(userDataPath, 'project-profiles.json'), JSON.stringify([{
    id: readyProjectId, name: 'Ready E2E Project', root: projectRoot, indexId: 'idx-ready-e2e-project', serverUrl, tokenEnv: 'MCP_BEARER_TOKEN',
    createdAt: new Date(0).toISOString(),
  }], null, 2), 'utf-8');
  writeReadyCodexEvidence(projectRoot);
  writeWatcherRuntime(projectRoot);
  return { rootPath, userDataPath };
}

function writeReadyCodexEvidence(projectRoot: string): void {
  const checkedAt = new Date().toISOString();
  const target = join(projectRoot, '.brain', 'service');
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, `ProjectBrainWatcher-${readyProjectId}.exe`), '', 'utf-8');
  writeFileSync(join(target, 'quality-gate-runs.json'), JSON.stringify({
    schemaVersion: 1,
    projectId: readyProjectId,
    projectRoot,
    checkedAt,
    staleAfterMs: 600000,
    commandRuns: {
      codexHooks: readyRun('Codex persistent-verifier plugin установлен.', 'codex plugin add persistent-verifier@claude-migrated-home', checkedAt),
    },
    verification: {
      codexTrust: readyRun('Codex project trust подтверждён.', 'read ~/.codex/config.toml projects trust', checkedAt),
      codexRuntime: readyRun('Codex CLI проверен.', 'codex --version', checkedAt),
      hookPersistence: readyRun('Codex SessionStart hook loaded persistent-verifier.', 'codex features list', checkedAt),
      runtimeContext: readyRun('Codex Runtime Context proof подтверждён native hooks.', 'python runtimecontext.py', checkedAt),
      smoke: readyRun('Проектный smoke gate выполнен.', 'npm test', checkedAt),
      rollback: readyRun('Rollback-команда доступна.', 'codex plugin remove persistent-verifier@claude-migrated-home', checkedAt),
    },
  }, null, 2), 'utf-8');
}

function writeWatcherRuntime(projectRoot: string): void {
  writeFileSync(join(projectRoot, '.brain', 'watcher-runtime.json'), JSON.stringify({
    owner: { project_id: readyProjectId, root: projectRoot, pid: process.pid },
    updated_at: Date.now(),
  }, null, 2), 'utf-8');
}

function readyRun(detail: string, command: string, checkedAt: string) {
  return { available: true, passed: true, detail, checkedAt, staleAfterMs: 600000, source: 'desktop-ready-e2e', command, exitCode: 0 };
}

async function launchDesktop(userDataPath: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: electronExecutable,
    args: [join(appRoot, 'dist', 'main.js')],
    env: {
      ...process.env,
      MCP_BEARER_TOKEN: fakeBearer, PROJECT_BRAIN_DESKTOP_USER_DATA_DIR: userDataPath, PROJECT_BRAIN_DESKTOP_DEBUG: '0', PROJECT_BRAIN_DESKTOP_DEVTOOLS: '0',
    },
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()));
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

async function readClipboard(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

function parseJsonRpc(body: string): { readonly id: unknown; readonly method: string } {
  try {
    const parsed = JSON.parse(body) as { readonly id?: unknown; readonly method?: unknown };
    return { id: parsed.id ?? null, method: typeof parsed.method === 'string' ? parsed.method : '' };
  } catch {
    return { id: null, method: '' };
  }
}
