import { test, expect, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const electronExecutable = String(require('electron'));
const appRoot = process.cwd();
const fakeBearer = 'pb_e2e_real_token_1234567890';

test('opens the real desktop control panel and proves the dry service rail', async ({}, testInfo) => {
  const mcpServer = await startMockMcpServer();
  const fixture = createFixture(mcpServer.url);
  const app = await launchDesktop(fixture.userDataPath, fixture.projectRoot);
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
    await expect(page.locator('[data-app-shell]')).toBeVisible();
    await expect(page.locator('[data-login-screen]')).toBeHidden();
    await expect(page.locator('[data-profile-card]')).toContainText('client@example.com');
    await expect(page.locator('[data-profile-card]')).toContainText('Пульт готов');
    await expect(page.getByRole('heading', { name: 'Проверка контура' })).toBeVisible();
    await expect(page.locator('[data-overall-status]')).not.toHaveText('Проверяем...');
    await expect(page.getByRole('button', { name: 'Конфиг' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Диагностика' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Проекты' })).toHaveCount(0);
    await expect(page.locator('[data-nav-section="settings"]')).toHaveCount(0);
    await expect(page.locator('[data-nav-section="projects"]')).toHaveCount(0);
    await expect(page.locator('[data-section="mcp"]')).toHaveCount(0);
    await expect(page.locator('[data-section="diagnostics"]')).toHaveCount(0);
    await expect(page.locator('[data-section="settings"]')).toHaveCount(0);
    await expect(page.locator('[data-section="projects"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Скачать файл настройки' })).toBeVisible();

    await page.locator('[data-project-select]').selectOption('client-project');
    await page.getByRole('button', { name: 'Обзор' }).click();
    const watcherInstallAction = page.locator('[data-node="watcher"] [data-check-action="install_service"]');
    await expect(watcherInstallAction).toBeVisible();
    await expect(watcherInstallAction).toHaveText('Установить службу');
    await watcherInstallAction.click();
    await expect(page.locator('[data-service-output]')).toContainText('Подтвердите действие «Установить службу»');

    await page.getByRole('button', { name: 'Промт' }).click();
    await expect(page.locator('[data-start-prompt]')).toContainText('BRAIN ON — Brain MCP bootstrap');
    await expect(page.locator('[data-start-prompt]')).toContainText('MCP-конфиг является единственным источником');
    await expect(page.locator('[data-start-prompt]')).toContainText('brain_status(project_id="client-project"');
    await expect(page.locator('[data-start-prompt]')).toContainText('reinitialize_project_route');
    await expect(page.locator('[data-start-prompt]')).toContainText('policy_workflow / operator_workflow');
    await expect(page.locator('[data-start-prompt]')).toContainText('policy_context_pack');
    await expect(page.locator('[data-start-prompt]')).toContainText('rail_context_pack');
    await expect(page.locator('[data-start-prompt]')).toContainText('required_next');
    await expect(page.locator('[data-start-prompt]')).not.toContainText(fakeBearer);
    await page.locator('[data-copy-prompt]').click();
    await expect(page.locator('[data-service-output]')).toContainText('Стартовый prompt скопирован');
    expect(await readClipboard(app)).toContain('brain_status(project_id="client-project"');

    await page.getByRole('button', { name: 'Режимы' }).click();
    await expect(page.locator('[data-section="modes"]')).toBeVisible();
    await expect(page.locator('[data-modes]')).toContainText('Основные MCP-режимы');
    await expect(page.locator('[data-modes]')).toContainText('Операторские режимы');
    await expect(page.locator('[data-modes]')).toContainText('Когда применять');
    await expect(page.locator('[data-modes]')).not.toContainText('Слои управления');
    await expect(page.locator('[data-modes]')).not.toContainText('Runtime, Policy, Gates');
    await page.screenshot({ path: testInfo.outputPath('desktop-modes-page.png'), fullPage: true });

    await page.getByRole('button', { name: 'Watcher' }).click();
    await expect(page.locator('[data-section="watcher"]')).toBeVisible();
    await expect(page.locator('[data-service-action="install"]')).toBeVisible();
    await expect(page.locator('[data-service-action="install"]')).toHaveAttribute('data-command-variant', 'primary');
    await expect(page.locator('[data-service-action="check_update"]')).toBeVisible();
    await expect(page.locator('[data-service-action="update"]')).toHaveAttribute('data-command-variant', 'danger');
    await expect(page.locator('[data-service-action="start"]')).toBeHidden();
    await expect(page.locator('[data-service-action="restart"]')).toBeHidden();
    await expect(page.locator('[data-service-action="stop"]')).toBeHidden();
    await page.locator('[data-service-action="health"]').click();
    await expect(page.locator('[data-service-output]')).toContainText('Проверка не пройдена');
    for (const action of ['install', 'update'] as const) {
      await page.locator(`[data-service-action="${action}"]`).click();
      await expect(page.locator('[data-service-output]')).toContainText('нажмите эту же кнопку ещё раз');
    }

    await page.getByLabel('Закрыть').click();
    await expect.poll(() => windowVisible(app)).toBe(false);
    await app.evaluate(({ app: electronApp }) => {
      electronApp.emit('second-instance', {}, [], process.cwd());
    });
    await expect.poll(() => windowVisible(app)).toBe(true);

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasHorizontalOverflow).toBe(false);
    expect(rendererErrors).toEqual([]);
    expect(mainErrors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('desktop-control-panel.png'), fullPage: true });
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
      const body = Buffer.concat(chunks).toString('utf-8');
      const payload = parseJsonRpc(body);
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
      if (payload.method === 'tools/list') {
        response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: { tools: [] } }));
        return;
      }
      response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: {} }));
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

function parseJsonRpc(body: string): { readonly id: unknown; readonly method: string } {
  try {
    const parsed = JSON.parse(body) as { readonly id?: unknown; readonly method?: unknown };
    return { id: parsed.id ?? null, method: typeof parsed.method === 'string' ? parsed.method : '' };
  } catch {
    return { id: null, method: '' };
  }
}

function createFixture(serverUrl: string): { readonly rootPath: string; readonly userDataPath: string; readonly projectRoot: string } {
  const rootPath = mkdtempSync(join(tmpdir(), 'watcher-desktop-e2e-'));
  const userDataPath = join(rootPath, 'user-data');
  const projectRoot = join(rootPath, 'MCP');
  const clientProjectRoot = join(rootPath, 'Client Project');
  mkdirSync(userDataPath, { recursive: true });
  mkdirSync(join(projectRoot, '.brain'), { recursive: true });
  mkdirSync(clientProjectRoot, { recursive: true });
  writeReadyCodexEvidence(projectRoot, 'mcp-monorepo');
  writeReadyCodexEvidence(clientProjectRoot, 'client-project');
  writeFileSync(join(userDataPath, 'project-profiles.json'), JSON.stringify([{
    id: 'mcp-monorepo',
    name: 'MCP Monorepo',
    root: projectRoot,
    indexId: 'idx-mcp-monorepo',
    serverUrl,
    tokenEnv: 'MCP_BEARER_TOKEN',
    createdAt: new Date(0).toISOString(),
  }, {
    id: 'client-project',
    name: 'Client Project',
    root: clientProjectRoot,
    indexId: 'idx-client-project',
    serverUrl,
    tokenEnv: 'MCP_BEARER_TOKEN',
    createdAt: new Date(1).toISOString(),
  }], null, 2), 'utf-8');
  return { rootPath, userDataPath, projectRoot };
}

function writeReadyCodexEvidence(projectRoot: string, projectId: string): void {
  const checkedAt = new Date().toISOString();
  const target = join(projectRoot, '.codex');
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'quality-gate-runs.json'), JSON.stringify({
    schemaVersion: 1,
    projectId,
    projectRoot,
    checkedAt,
    staleAfterMs: 600000,
    commandRuns: {
      codexHooks: readyRun('Codex persistent-verifier plugin установлен.', 'desktop-codex-gates', 'codex plugin add persistent-verifier@claude-migrated-home', checkedAt),
    },
    verification: {
      codexTrust: readyRun('Codex project trust подтверждён.', 'desktop-codex-gates', 'read ~/.codex/config.toml projects trust', checkedAt),
      codexRuntime: readyRun('Codex CLI проверен.', 'desktop-codex-gates', 'codex --version', checkedAt),
      hookPersistence: {
        available: true,
        passed: true,
        detail: 'Codex SessionStart hook loaded persistent-verifier.',
        checkedAt,
        staleAfterMs: 600000,
        source: 'persistent-verifier',
        command: 'codex features list',
        exitCode: 0,
        runId: 'hookPersistence-e2e-ready',
      },
      smoke: readyRun('Проектный smoke gate выполнен.', 'desktop-codex-gates', 'npm test', checkedAt),
      rollback: readyRun('Rollback-команда доступна.', 'desktop-codex-gates', 'codex plugin remove persistent-verifier@claude-migrated-home', checkedAt),
    },
  }, null, 2), 'utf-8');
}

function readyRun(detail: string, source: string, command: string, checkedAt: string) {
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

async function launchDesktop(userDataPath: string, projectRoot: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: electronExecutable,
    args: [join(appRoot, 'dist', 'main.js')],
    env: {
      ...process.env,
      MCP_BEARER_TOKEN: fakeBearer,
      PROJECT_BRAIN_DESKTOP_USER_DATA_DIR: userDataPath,
      PROJECT_BRAIN_DESKTOP_DEBUG: '0',
      PROJECT_BRAIN_DESKTOP_DEVTOOLS: '0',
      PROJECT_BRAIN_E2E_PROJECT_ROOT: projectRoot,
    },
  });
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

async function windowVisible(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() === true);
}
