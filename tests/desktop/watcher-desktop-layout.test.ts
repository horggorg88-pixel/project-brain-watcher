import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layoutCss = readFileSync(new URL('../../apps/watcher-desktop/src/styles/layout.css', import.meta.url), 'utf-8');
const themesCss = readFileSync(new URL('../../apps/watcher-desktop/src/styles/themes.css', import.meta.url), 'utf-8');
const indexHtml = readFileSync(new URL('../../apps/watcher-desktop/src/index.html', import.meta.url), 'utf-8');
const rendererTs = readFileSync(new URL('../../apps/watcher-desktop/src/renderer.ts', import.meta.url), 'utf-8');

describe('watcher desktop layout shell contracts', () => {
  it('keeps the window titlebar, project topbar and log dock as separate sticky layers', () => {
    expect(indexHtml).toContain('class="window-titlebar"');
    expect(indexHtml).toContain('class="topbar"');
    expect(indexHtml).toContain('class="bottom-console"');

    expect(cssRule('.window-titlebar')).toContain('position: sticky');
    expect(cssRule('.window-titlebar')).toContain('top: 0');
    expect(cssRule('.topbar')).toContain('position: sticky');
    expect(cssRule('.topbar')).toContain('top: 42px');
    expect(cssRule('.bottom-console')).toContain('position: sticky');
    expect(cssRule('.bottom-console')).toContain('bottom: 14px');
  });

  it('reserves workspace space for the expanded log dock', () => {
    expect(cssRule('.workspace')).toContain('padding-bottom: var(--bottom-console-space)');
    expect(layoutCss).toContain('--bottom-console-space: 190px');
  });

  it('keeps the app version only in the titlebar', () => {
    expect(indexHtml.match(/data-app-version/g) ?? []).toHaveLength(1);
    expect(indexHtml).toContain('class="window-version" data-app-version');
    expect(indexHtml).not.toContain('class="version-chip" data-app-version');
  });

  it('lets the bottom log console grow upward and invert in dark mode', () => {
    expect(cssRule('.bottom-console')).toContain('resize: vertical');
    expect(cssRule('.bottom-console')).toContain('height: 170px');
    expect(cssRule('.bottom-console pre')).toContain('height: calc(100% - 47px)');
    expect(themesRule('body[data-theme="dark"] .bottom-console')).toContain('background: #f4f4f0');
    expect(themesRule('body[data-theme="dark"] .bottom-console')).toContain('color: #111');
    expect(themesRule('body[data-theme="dark"] .bottom-console pre')).toContain('color: #111');
  });

  it('keeps manual contour checks visible in the bottom log console', () => {
    expect(rendererTs).toContain('runFullCheckFromUi()');
    expect(rendererTs).toContain('connectionCheckLog(currentConnectionCheck)');
    expect(rendererTs).toContain('Маршрут проверки:');
  });
});

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{(?<body>[^}]+)\\}`, 'm').exec(layoutCss);
  expect(match?.groups?.body, `${selector} rule exists`).toBeTruthy();
  return match?.groups?.body ?? '';
}

function themesRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{(?<body>[^}]+)\\}`, 'm').exec(themesCss);
  expect(match?.groups?.body, `${selector} rule exists`).toBeTruthy();
  return match?.groups?.body ?? '';
}
