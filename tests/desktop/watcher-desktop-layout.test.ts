import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layoutCss = readFileSync(new URL('../../apps/watcher-desktop/src/styles/layout.css', import.meta.url), 'utf-8');
const indexHtml = readFileSync(new URL('../../apps/watcher-desktop/src/index.html', import.meta.url), 'utf-8');

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
});

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{(?<body>[^}]+)\\}`, 'm').exec(layoutCss);
  expect(match?.groups?.body, `${selector} rule exists`).toBeTruthy();
  return match?.groups?.body ?? '';
}
