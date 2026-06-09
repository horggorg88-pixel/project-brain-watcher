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

export function readDesktopServiceToken(profile: SavedProjectProfile): string | null {
  const envToken = process.env[profile.tokenEnv];
  if (isConcreteBearerToken(envToken)) return envToken.trim();
  const secret = readDesktopServiceSecret(profile);
  return isConcreteBearerToken(secret) ? secret.trim() : null;
}

export function syncDesktopServiceSecretFromEnv(profile: SavedProjectProfile): DesktopServiceSecretState | null {
  const envToken = process.env[profile.tokenEnv];
  if (!isConcreteBearerToken(envToken)) return null;
  const token = envToken.trim();
  if (readDesktopServiceSecret(profile)?.trim() === token) return readDesktopServiceSecretState(profile);
  return stageDesktopServiceSecret(profile, token);
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
        repairHint: 'Сначала импортируйте файл настройки MCP проекта.',
      },
    };
  }
  const tokenFilePath = serviceTokenFilePath(profile);
  const health = readRestrictedSecretHealth(tokenFilePath);
  const secret = readDesktopServiceSecret(profile);
  const concreteSecret = isConcreteBearerToken(secret);
  const concreteEnv = isConcreteBearerToken(process.env[profile.tokenEnv]);
  return {
    configured: concreteSecret || (health.configured && concreteEnv),
    tokenFilePath,
    tokenEnv: profile.tokenEnv,
    actualFingerprint: health.actualFingerprint,
    acl: health.acl,
  };
}

export function isConcreteBearerToken(token: string | null | undefined): token is string {
  const value = token?.trim();
  if (!value || value.length < 12) return false;
  if (/^\$\{[^}]+\}$/.test(value)) return false;
  if (/^%[^%]+%$/.test(value)) return false;
  if (/^<[^>]+>$/.test(value)) return false;
  const normalized = value.toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'pb_secret_value' || normalized === 'secret_value') return false;
  if (normalized === 'mcp_bearer_token' || normalized === 'project_brain_token') return false;
  if (normalized.includes('placeholder') || normalized.includes('replace_me')) return false;
  if (normalized.includes('your_token') || normalized.includes('example_token')) return false;
  return true;
}
