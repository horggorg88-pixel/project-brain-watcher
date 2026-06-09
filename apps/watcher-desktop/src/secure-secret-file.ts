import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { SecretAclHealth } from './contracts.js';

export interface RestrictedSecretHealth {
  readonly configured: boolean;
  readonly tokenFilePath: string;
  readonly actualFingerprint: string | null;
  readonly acl: SecretAclHealth;
}

export function writeRestrictedSecretFile(path: string, token: string): boolean {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${token.trim()}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
  return restrictSecretAcl(path);
}

export function readRestrictedSecretFile(path: string): string | null {
  if (!existsSync(path)) return null;
  const token = readFileSync(path, 'utf8').trim();
  return token.length > 0 ? token : null;
}

export function readRestrictedSecretHealth(tokenFilePath: string): RestrictedSecretHealth {
  if (!existsSync(tokenFilePath)) {
    return {
      configured: false,
      tokenFilePath,
      actualFingerprint: null,
      acl: {
        restricted: false,
        reason: 'secret_file_missing',
        repairHint: 'Повторите импорт файла настройки MCP из личного кабинета.',
      },
    };
  }
  const token = readRestrictedSecretFile(tokenFilePath);
  const acl = restrictSecretAcl(tokenFilePath);
  return {
    configured: token !== null,
    tokenFilePath,
    actualFingerprint: token ? buildRedactedSecretFingerprint(token) : null,
    acl: {
      restricted: acl,
      reason: acl ? null : 'acl_restriction_failed',
      repairHint: acl ? null : 'Запустите импорт файла настройки повторно или откройте пульт от имени пользователя с правами на файл.',
    },
  };
}

export function buildRedactedSecretFingerprint(token: string): string {
  const normalized = token.trim();
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return `sha256:${digest}:len=${normalized.length}`;
}

function restrictSecretAcl(path: string): boolean {
  if (process.platform !== 'win32') return true;
  const userGrant = `${process.env.USERDOMAIN ?? '.'}\\${process.env.USERNAME ?? ''}:F`;
  const grants = ['*S-1-5-18:R', '*S-1-5-32-544:F', userGrant].filter(grant => !grant.endsWith('\\:F'));
  const result = spawnSync('icacls.exe', [path, '/inheritance:r', '/grant:r', ...grants], {
    stdio: 'ignore',
    windowsHide: true,
  });
  return result.status === 0;
}
