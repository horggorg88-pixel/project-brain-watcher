import { expect, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const electronExecutable = String(require('electron'));
const appRoot = process.cwd();

export interface LiveDesktopFixture {
  readonly consoleUrl: string;
  readonly email: string;
  readonly password: string;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly rootPath: string;
  readonly serverUrl: string;
  readonly userDataPath: string;
}

export function createLiveDesktopFixture(): LiveDesktopFixture {
  const projectRoot = process.env.PB_E2E_PROJECT_ROOT || join(homedir(), 'Desktop', 'mcp-monorepo');
  if (!existsSync(projectRoot)) {
    throw new Error(`Live E2E project root does not exist: ${projectRoot}`);
  }
  const email = requiredEnv('PB_E2E_EMAIL');
  const password = requiredEnv('PB_E2E_PASSWORD');
  const projectId = process.env.PB_E2E_PROJECT_ID || 'mcp-monorepo';
  const serverUrl = process.env.PB_E2E_SERVER_URL || 'http://149.33.14.250';
  const consoleUrl = process.env.PB_E2E_CONSOLE_URL || 'http://149.33.14.250:3020';
  const rootPath = mkdtempSync(join(tmpdir(), 'watcher-desktop-live-e2e-'));
  const userDataPath = join(rootPath, 'user-data');
  mkdirSync(userDataPath, { recursive: true });
  writeFileSync(join(userDataPath, 'project-profiles.json'), JSON.stringify([{
    id: projectId,
    name: projectId,
    root: projectRoot,
    indexId: `idx-${projectId}`,
    serverUrl,
    consoleUrl,
    tokenEnv: 'MCP_BEARER_TOKEN',
    createdAt: new Date(0).toISOString(),
  }], null, 2), 'utf-8');
  return { consoleUrl, email, password, projectId, projectRoot, rootPath, serverUrl, userDataPath };
}

export async function launchLiveDesktop(fixture: LiveDesktopFixture): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: electronExecutable,
    args: [join(appRoot, 'dist', 'main.js')],
    env: {
      ...process.env,
      MCP_ONBOARDING_SERVER_URL: fixture.consoleUrl,
      PROJECT_BRAIN_DESKTOP_USER_DATA_DIR: fixture.userDataPath,
      PROJECT_BRAIN_DESKTOP_DEBUG: '0',
      PROJECT_BRAIN_DESKTOP_DEVTOOLS: '0',
      PROJECT_BRAIN_DESKTOP_E2E_SKIP_SUPPORT_ENROLLMENT: '1',
      PROJECT_BRAIN_E2E_PROJECT_ROOT: fixture.projectRoot,
    },
  });
}

export async function loginWithLiveAccount(page: Page, fixture: LiveDesktopFixture): Promise<void> {
  await expect(page.locator('[data-login-screen]')).toBeVisible();
  await page.getByLabel('Почта').fill(fixture.email);
  await page.getByLabel('Пароль или барьер-ключ').fill(fixture.password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-access', 'signed-in', { timeout: 30_000 });
}

export function cleanupLiveDesktopFixture(fixture: LiveDesktopFixture): void {
  rmSync(fixture.rootPath, { recursive: true, force: true });
  if (!existsSync(fixture.projectRoot)) {
    throw new Error(`Live E2E removed project root unexpectedly: ${fixture.projectRoot}`);
  }
}

export function collectRendererErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

export function collectMainErrors(app: ElectronApplication): string[] {
  const errors: string[] = [];
  app.process().stderr?.on('data', chunk => {
    const value = String(chunk).trim();
    if (value) errors.push(value);
  });
  return errors;
}

export async function readClipboard(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ clipboard }) => clipboard.readText());
}

export function readServiceEvidence(projectRoot: string): unknown {
  const path = join(projectRoot, '.brain', 'service', 'quality-gate-runs.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : null;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for live desktop E2E`);
  return value;
}
