import { describe, expect, it } from 'vitest';
import {
  buildReleaseVersionCheck,
  formatReleaseVersionCheck,
  normalizeReleaseVersion,
} from '../../apps/watcher-desktop/src/desktop-release-update.js';

describe('watcher desktop release update checks', () => {
  it('normalizes GitHub release tags before comparing versions', () => {
    expect(normalizeReleaseVersion('v1.4.15')).toBe('1.4.15');
    expect(normalizeReleaseVersion('  1.4.15  ')).toBe('1.4.15');
  });

  it('marks desktop and watcher lanes outdated when GitHub has a newer release', () => {
    const check = buildReleaseVersionCheck({
      currentDesktopVersion: '1.4.15',
      currentWatcherVersion: '1.4.15',
      latestTagName: 'v1.4.16',
      releaseUrl: 'https://github.com/horggorg88-pixel/project-brain-watcher/releases/tag/v1.4.16',
    });

    expect(check.latestVersion).toBe('1.4.16');
    expect(check.desktop.outdated).toBe(true);
    expect(check.watcher.outdated).toBe(true);
    expect(formatReleaseVersionCheck(check)).toContain('Пульт: 1.4.15 -> 1.4.16');
    expect(formatReleaseVersionCheck(check)).toContain('Watcher: 1.4.15 -> 1.4.16');
  });

  it('keeps both lanes current when bundled versions match the latest release', () => {
    const check = buildReleaseVersionCheck({
      currentDesktopVersion: '1.4.15',
      currentWatcherVersion: '1.4.15',
      latestTagName: 'v1.4.15',
      releaseUrl: 'https://github.com/horggorg88-pixel/project-brain-watcher/releases/tag/v1.4.15',
    });

    expect(check.desktop.outdated).toBe(false);
    expect(check.watcher.outdated).toBe(false);
    expect(formatReleaseVersionCheck(check)).toContain('Пульт: 1.4.15 актуален');
    expect(formatReleaseVersionCheck(check)).toContain('Watcher: 1.4.15 актуален');
  });
});
