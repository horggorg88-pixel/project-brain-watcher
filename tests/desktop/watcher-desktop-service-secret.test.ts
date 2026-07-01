import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SavedProjectProfile } from '../../apps/watcher-desktop/src/contracts.js';
import {
  buildDesktopServiceSecretLeaseReceipt,
  readDesktopServiceSecret,
  readDesktopServiceSecretState,
  stageDesktopServiceSecret,
} from '../../apps/watcher-desktop/src/desktop-service-secret.js';
import { buildRedactedSecretFingerprint } from '../../apps/watcher-desktop/src/secure-secret-file.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('watcher desktop service secret', () => {
  it('rotates the service secret through the same redacted status contract', () => {
    const profile = profileFixture();
    stageDesktopServiceSecret(profile, 'old_service_secret_1234567890');

    const stale = readDesktopServiceSecretState(profile, 'new_service_secret_1234567890');
    const rotated = stageDesktopServiceSecret(profile, 'new_service_secret_1234567890');
    const serialized = JSON.stringify({ stale, rotated });

    expect(stale.matchesExpected).toBe(false);
    expect(stale.rotationRequired).toBe(true);
    expect(rotated.matchesExpected).toBe(true);
    expect(rotated.rotationRequired).toBe(false);
    expect(rotated.actualFingerprint).toBe(buildRedactedSecretFingerprint('new_service_secret_1234567890'));
    expect(readDesktopServiceSecret(profile)).toBe('new_service_secret_1234567890');
    expect(serialized).not.toContain('old_service_secret');
    expect(serialized).not.toContain('new_service_secret');
  });

  it('builds a watcher-secret lease receipt without raw bearer or owner fields', () => {
    const profile = profileFixture();
    stageDesktopServiceSecret(profile, 'desktop_service_secret_1234567890');
    const state = readDesktopServiceSecretState(profile, 'rotated_service_secret_1234567890');

    const receipt = buildDesktopServiceSecretLeaseReceipt({
      profile,
      state,
      leaseOwner: {
        instanceId: 'desktop-watcher-instance',
        leaseId: 'desktop-lease-id',
        hostname: 'student-host',
      },
    });
    const serialized = JSON.stringify(receipt);

    expect(receipt.version).toBe('watcher-secret-lease-receipt/v1');
    expect(receipt.tokenFileFingerprint).toBe(state.tokenFileFingerprint);
    expect(receipt.secret).toMatchObject({
      configured: true,
      matchesExpected: false,
      rotationRequired: true,
      aclRestricted: true,
      aclReason: null,
    });
    expect(receipt.leaseOwner).toMatchObject({
      projectFingerprint: buildRedactedSecretFingerprint('desktop-project'),
      instanceFingerprint: buildRedactedSecretFingerprint('desktop-watcher-instance'),
      leaseFingerprint: buildRedactedSecretFingerprint('desktop-lease-id'),
      rootFingerprint: buildRedactedSecretFingerprint(profile.root),
      serverFingerprint: buildRedactedSecretFingerprint(profile.serverUrl),
    });
    expect(serialized).not.toContain('desktop_service_secret');
    expect(serialized).not.toContain('rotated_service_secret');
    expect(serialized).not.toContain('desktop-project');
    expect(serialized).not.toContain('desktop-watcher-instance');
    expect(serialized).not.toContain('desktop-lease-id');
    expect(serialized).not.toContain(profile.root);
    expect(serialized).not.toContain(profile.serverUrl);
  });

  it('does not mark a wide POSIX secret mode as ACL restricted', () => {
    const profile = profileFixture();
    stageDesktopServiceSecret(profile, 'posix_desktop_secret_1234567890');
    const secretPath = join(profile.root, '.brain', 'service', `${profile.tokenEnv}.secret`);

    if (process.platform !== 'win32') chmodSync(secretPath, 0o644);
    const state = readDesktopServiceSecretState(profile);

    if (process.platform === 'win32') {
      expect(state.acl.restricted).toBe(true);
      return;
    }
    expect(state.acl.restricted).toBe(false);
    expect(state.acl.reason).toBe('acl_restriction_failed');
  });
});

function profileFixture(): SavedProjectProfile {
  const root = mkdtempSync(join(tmpdir(), 'watcher-desktop-service-secret-'));
  tempDirs.push(root);
  return {
    id: 'desktop-project',
    name: 'Desktop Project',
    root,
    indexId: 'idx-desktop-project',
    serverUrl: 'http://149.33.14.250',
    tokenEnv: 'MCP_BEARER_TOKEN',
    createdAt: '2026-06-30T00:00:00.000Z',
  };
}
