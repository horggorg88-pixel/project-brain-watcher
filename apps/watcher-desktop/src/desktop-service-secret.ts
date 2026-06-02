import { join } from 'node:path';
import type { SavedProjectProfile, SecretAclHealth } from './contracts.js';
import {
  readRestrictedSecretFile,
  readRestrictedSecretHealth,
  writeRestrictedSecretFile,
} from './secure-secret-file.js';

export interface DesktopServiceSecretState {
  readonly configured: boolean;
  readonly tokenFilePath: string | null;
  readonly tokenEnv: string;
  readonly actualFingerprint: string | null;
  readonly acl: SecretAclHealth;
}

export function serviceTokenFilePath(profile: SavedProjectProfile): string {
  return join(profile.root, '.brain', 'service', `${profile.tokenEnv}.secret`);
}

export function stageDesktopServiceSecret(profile: SavedProjectProfile, token: string): DesktopServiceSecretState {
  const tokenFilePath = serviceTokenFilePath(profile);
  writeRestrictedSecretFile(tokenFilePath, token);
  return readDesktopServiceSecretState(profile);
}

export function readDesktopServiceSecret(profile: SavedProjectProfile): string | null {
  return readRestrictedSecretFile(serviceTokenFilePath(profile));
}

export function readDesktopServiceSecretState(profile: SavedProjectProfile | null): DesktopServiceSecretState {
  if (!profile) {
    return {
      configured: false,
      tokenFilePath: null,
      tokenEnv: 'MCP_BEARER_TOKEN',
      actualFingerprint: null,
      acl: {
        restricted: false,
        reason: 'profile_missing',
        repairHint: 'Сначала импортируйте MCP-конфиг проекта.',
      },
    };
  }
  const tokenFilePath = serviceTokenFilePath(profile);
  const health = readRestrictedSecretHealth(tokenFilePath);
  return {
    configured: health.configured,
    tokenFilePath,
    tokenEnv: profile.tokenEnv,
    actualFingerprint: health.actualFingerprint,
    acl: health.acl,
  };
}
