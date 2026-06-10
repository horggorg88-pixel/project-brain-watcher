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

    await page.getByRole('button', { name: 'Конфиг' }).click();
    await expect(page.locator('[data-section="mcp"]')).toBeVisible();
    await expect(page.locator('[data-config-json]')).toContainText('project-brain');
    await expect(page.locator('[data-config-json]')).toContainText(`Bearer ${fakeBearer}`);
    await page.locator('[data-copy-config]').click();
    await expect(page.locator('[data-service-output]')).toContainText('Файл настройки MCP скопирован');
    expect(await readClipboard(app)).toContain(`Bearer ${fakeBearer}`);

    await page.locator('[data-project-select]').selectOption('client-project');
    await expect(page.locator('[data-config-json]')).toContainText('client-project');
    await expect(page.locator('[data-start-prompt]')).toContainText('brain_status(project_id="client-project"');

    await page.getByRole('button', { name: 'Промт' }).click();
    await expect(page.locator('[data-start-prompt]')).toContainText('BRAIN ON — Brain MCP bootstrap');
    await expect(page.locator('[data-start-prompt]')).toContainText('MCP-конфиг является единственным источником');
    await expect(page.locator('[data-start-prompt]')).toContainText('brain_status(project_id="client-project"');
    await expect(page.locator('[data-start-prompt]')).toContainText('reinitialize_project_route');
    await expect(page.locator('[data-start-prompt]')).toContainText('policy_workflow / operator_workflow');
    await expect(page.locator('[data-start-prompt]')).toContainText('policy_context_pack');
    await expect(page.locator('[data-start-prompt]')).not.toContainText(fakeBearer);
    await page.locator('[data-copy-prompt]').click();
    await expect(page.locator('[data-service-output]')).toContainText('Стартовый prompt скопирован');
    expect(await readClipboard(app)).toContain('brain_status(project_id="client-project"');

    await page.getByRole('button', { name: 'Watcher' }).click();
    await expect(page.locator('[data-section="watcher"]')).toBeVisible();
    await page.locator('[data-service-action="health"]').click();
    await expect(page.locator('[data-service-output]')).toContainText('Проверка не пройдена');
    for (const action of ['install', 'start', 'restart', 'stop'] as const) {
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
