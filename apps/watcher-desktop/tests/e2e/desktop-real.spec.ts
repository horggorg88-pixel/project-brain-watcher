import { test, expect } from '@playwright/test';
import {
  cleanupLiveDesktopFixture,
  collectMainErrors,
  collectRendererErrors,
  createLiveDesktopFixture,
  launchLiveDesktop,
  loginWithLiveAccount,
  readClipboard,
} from './live-desktop-fixture.js';

test('opens the desktop control panel with the real account and real project', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const fixture = createLiveDesktopFixture();
  const app = await launchLiveDesktop(fixture);
  const page = await app.firstWindow();
  const rendererErrors = collectRendererErrors(page);
  const mainErrors = collectMainErrors(app);

  try {
    await loginWithLiveAccount(page, fixture);

    await expect(page.locator('[data-app-shell]')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-server-verified', 'true', { timeout: 30_000 });
    await expect(page.locator('[data-profile-card]')).toContainText(fixture.email);
    await expect(page.locator('[data-project-select-button]')).toContainText(fixture.projectId);
    await expect(page.locator('[data-node="project"]')).toContainText(fixture.projectRoot);
    await expect(page.locator('[data-node="config"]')).toContainText('Файл настройки принят');
    await expect(page.locator('[data-node="key"]')).toContainText('Ключ сохранён локально');

    await page.getByRole('button', { name: 'Проверить подключение' }).click();
    await expect(page.locator('[data-overall-status]')).not.toHaveText('Проверяем...', { timeout: 30_000 });
    await expect(page.locator('[data-node="server"]')).toContainText(/Сервер|MCP/);

    await page.getByRole('button', { name: 'Промт' }).click();
    await expect(page.locator('[data-start-prompt]')).toContainText(`brain_status(project_id="${fixture.projectId}"`);
    await expect(page.locator('[data-start-prompt]')).toContainText(fixture.projectRoot);
    await expect(page.locator('[data-start-prompt]')).not.toContainText(fixture.password);
    await page.locator('[data-copy-prompt]').click();
    expect(await readClipboard(app)).toContain(`brain_status(project_id="${fixture.projectId}"`);

    await page.getByRole('button', { name: 'Watcher' }).click();
    await expect(page.locator('[data-service-summary]')).not.toHaveText('Проверяем...', { timeout: 30_000 });
    await page.locator('[data-copy-service-logs]').click();
    await expect(page.locator('[data-service-output]')).toContainText('AI snapshot логов службы скопирован');
    expect(await readClipboard(app)).toContain(`"project": "${fixture.projectId}"`);

    await page.locator('[data-remove-project]').click();
    await expect(page.locator('[data-service-output]')).toContainText('Проект убран из списка пульта');
    await expect(page.locator('[data-service-output]')).toContainText('Папка на диске не удалялась');
    await expect(page.locator('[data-project-select-button]')).toContainText('Проект не выбран', { timeout: 30_000 });

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasHorizontalOverflow).toBe(false);
    expect(rendererErrors).toEqual([]);
    expect(mainErrors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('desktop-live-real-project.png'), fullPage: true });
  } finally {
    await app.close();
    cleanupLiveDesktopFixture(fixture);
  }
});
