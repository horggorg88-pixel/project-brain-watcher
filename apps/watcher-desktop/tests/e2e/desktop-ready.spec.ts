import { test, expect } from '@playwright/test';
import {
  cleanupLiveDesktopFixture,
  collectMainErrors,
  collectRendererErrors,
  createLiveDesktopFixture,
  launchLiveDesktop,
  loginWithLiveAccount,
} from './live-desktop-fixture.js';

test('keeps live desktop navigation and mode controls clean for the real project', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const fixture = createLiveDesktopFixture();
  const app = await launchLiveDesktop(fixture);
  const page = await app.firstWindow();
  const rendererErrors = collectRendererErrors(page);
  const mainErrors = collectMainErrors(app);

  try {
    await loginWithLiveAccount(page, fixture);
    await expect(page.locator('[data-project-select-button]')).toContainText(fixture.projectId);
    await page.locator('[data-project-select-button]').click();
    await expect(page.locator(`[data-project-option="${fixture.projectId}"]`)).toContainText(fixture.projectRoot);
    await expect(page.locator('[data-project-select-menu]')).not.toContainText('Client Project');
    await expect(page.locator('[data-project-select-menu]')).not.toContainText('ready-e2e-project');
    await page.locator(`[data-project-option="${fixture.projectId}"]`).click();

    await expect(page.getByRole('button', { name: 'Проекты' })).toHaveCount(0);
    await expect(page.locator('[data-section="projects"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Режимы' }).click();
    await expect(page.locator('[data-section="modes"]')).toBeVisible();
    await page.locator('[data-mode-step="next"]').click();
    await page.locator('[data-mode-select-button]').click();
    await expect(page.locator('[data-mode-select-menu]')).toBeVisible();
    await page.locator('[data-mode-option]').first().click();
    await expect(page.locator('[data-modes]')).toContainText('Когда применять');

    await page.locator('[data-toggle-theme]').click();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'dark');
    await page.locator('[data-mode-select-button]').click();
    await expect(page.locator('[data-mode-select-menu]')).toBeVisible();
    await page.locator('[data-toggle-theme]').click();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'light');

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasHorizontalOverflow).toBe(false);
    expect(rendererErrors).toEqual([]);
    expect(mainErrors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('desktop-live-modes.png'), fullPage: true });
  } finally {
    await app.close();
    cleanupLiveDesktopFixture(fixture);
  }
});
