import { test, expect } from '@playwright/test';
import {
  cleanupLiveDesktopFixture,
  collectMainErrors,
  collectRendererErrors,
  createLiveDesktopFixture,
  launchLiveDesktop,
  loginWithLiveAccount,
  readServiceEvidence,
} from './live-desktop-fixture.js';

test('runs Codex Gates from the desktop control panel on the real project', async ({}, testInfo) => {
  test.setTimeout(240_000);
  const fixture = createLiveDesktopFixture();
  const app = await launchLiveDesktop(fixture);
  const page = await app.firstWindow();
  const rendererErrors = collectRendererErrors(page);
  const mainErrors = collectMainErrors(app);

  try {
    await loginWithLiveAccount(page, fixture);
    await expect(page.locator('[data-node="codexGates"]')).toContainText('Codex Gates', { timeout: 60_000 });
    const action = page.locator('[data-node="codexGates"] [data-check-action="verify_codex_gates"]');
    if (await action.count()) {
      await action.click();
      await expect(page.locator('[data-service-output]')).toContainText('Codex Gates diagnostics', { timeout: 180_000 });
    }
    const liveResult = await verifyCodexGatesFromDesktop(page, fixture.projectId);
    const resultText = JSON.stringify(liveResult);
    expect(resultText).toContain('npm test');
    expect(resultText).not.toContain(fixture.password);

    const evidence = readServiceEvidence(fixture.projectRoot);
    expect(isRecord(evidence)).toBe(true);
    const projectId = isRecord(evidence) ? evidence.projectId : null;
    expect(projectId).toBe(fixture.projectId);
    const text = JSON.stringify(evidence);
    expect(text).toContain('codex --version');
    expect(text).toContain('codex plugin add persistent-verifier@claude-migrated-home');
    expect(text).toContain('npm test');
    expect(text).not.toContain(fixture.password);
    await expect(page.locator('[data-node="codexGates"]')).not.toContainText('Ждём project_id');
    expect(rendererErrors).toEqual([]);
    expect(mainErrors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('desktop-live-codex-gates.png'), fullPage: true });
  } finally {
    await app.close();
    cleanupLiveDesktopFixture(fixture);
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function verifyCodexGatesFromDesktop(page: import('@playwright/test').Page, projectId: string): Promise<unknown> {
  return page.evaluate(async selectedProjectId => {
    type DesktopWindow = Window & {
      watcherDesktop?: {
        codexGates?: {
          verify(projectId: string): Promise<unknown>;
        };
      };
    };
    const api = (window as DesktopWindow).watcherDesktop?.codexGates;
    if (!api) throw new Error('watcherDesktop.codexGates API is not available');
    return api.verify(selectedProjectId);
  }, projectId);
}
