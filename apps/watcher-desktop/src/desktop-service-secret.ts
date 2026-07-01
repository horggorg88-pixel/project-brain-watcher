import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SavedProjectProfile, SecretAclHealth } from './contracts.js';
import {
  buildRedactedSecretFingerprint,
  readRestrictedSecretFile,
  readRestrictedSecretHealth,
  writeRestrictedSecretFile,
} from './secure-secret-file.js';

export interface DesktopServiceSecretState {
  readonly configured: boolean;
  readonly tokenFileFingerprint: string | null;
  readonly tokenEnv: string;
  readonly expectedFingerprint: string | null;
  readonly actualFingerprint: string | null;
  readonly matchesExpected: boolean | null;
  readonly rotationRequired: boolean;
  readonly acl: SecretAclHealth;
}

export interface DesktopServiceSecretLeaseOwner {
  readonly projectId?: string | null;
  readonly instanceId?: string | null;
  readonly leaseId?: string | null;
  readonly hostname?: string | null;
  readonly root?: string | null;
  readonly server?: string | null;
}

export interface DesktopServiceSecretLeaseReceipt {
  readonly version: 'watcher-secret-lease-receipt/v1';
  readonly tokenEnv: string;
  readonly tokenFileFingerprint: string | null;
  readonly secret: {
    readonly configured: boolean;
    readonly expectedFingerprint: string | null;
    readonly actualFingerprint: string | null;
    readonly matchesExpected: boolean | null;
    readonly rotationRequired: boolean;
    readonly aclRestricted: boolean;
    readonly aclReason: string | null;
  };
  readonly leaseOwner: {
    readonly projectFingerprint: string | null;
    readonly instanceFingerprint: string | null;
    readonly leaseFingerprint: string | null;
    readonly hostFingerprint: string | null;
    readonly rootFingerprint: string | null;
    readonly serverFingerprint: string | null;
  };
}

export function serviceTokenFilePath(profile: SavedProjectProfile): string {
  return join(profile.root, '.brain', 'service', `${profile.tokenEnv}.secret`);
}

export function stageDesktopServiceSecret(profile: SavedProjectProfile, token: string): DesktopServiceSecretState {
  const tokenFilePath = serviceTokenFilePath(profile);
  writeRestrictedSecretFile(tokenFilePath, token);
  return readDesktopServiceSecretState(profile, token);
}

export function readDesktopServiceSecret(profile: SavedProjectProfile): string | null {
  return readRestrictedSecretFile(serviceTokenFilePath(profile));
}

export function readDesktopServiceToken(profile: SavedProjectProfile): string | null {
  const secret = readDesktopServiceSecret(profile);
  if (isConcreteBearerToken(secret)) return secret.trim();
  return readDesktopEnvServiceToken(profile);
}

export function readDesktopEnvServiceToken(profile: SavedProjectProfile): string | null {
  const envToken = process.env[profile.tokenEnv];
  if (isConcreteBearerToken(envToken)) return envToken.trim();
  return null;
}

export function syncDesktopServiceSecretFromEnv(profile: SavedProjectProfile): DesktopServiceSecretState | null {
  const envToken = process.env[profile.tokenEnv];
  if (!isConcreteBearerToken(envToken)) return null;
  const token = envToken.trim();
  if (readDesktopServiceSecret(profile)?.trim() === token) return readDesktopServiceSecretState(profile);
  return stageDesktopServiceSecret(profile, token);
}

export function syncDesktopServiceSecretFromProjectMcp(profile: SavedProjectProfile): DesktopServiceSecretState | null {
  const token = readProjectMcpBearerToken(profile) ?? readProjectConfigPackageBearerToken(profile);
  if (!token) return null;
  if (readDesktopServiceSecret(profile)?.trim() === token) return readDesktopServiceSecretState(profile);
  return stageDesktopServiceSecret(profile, token);
}

export function readDesktopServiceSecretState(
  profile: SavedProjectProfile | null,
  expectedToken?: string | null,
): DesktopServiceSecretState {
  if (!profile) {
    return {
      configured: false,
      tokenFileFingerprint: null,
      tokenEnv: 'MCP_BEARER_TOKEN',
      expectedFingerprint: expectedToken ? buildRedactedSecretFingerprint(expectedToken) : null,
      actualFingerprint: null,
      matchesExpected: expectedToken ? false : null,
      rotationRequired: expectedToken ? true : false,
      acl: {
        restricted: false,
        reason: 'profile_missing',
        repairHint: 'Сначала импортируйте файл настройки MCP проекта.',
      },
    };
  }
  const tokenFilePath = serviceTokenFilePath(profile);
  const health = readRestrictedSecretHealth(tokenFilePath, expectedToken);
  const secret = readDesktopServiceSecret(profile);
  const concreteSecret = isConcreteBearerToken(secret);
  const concreteEnv = isConcreteBearerToken(process.env[profile.tokenEnv]);
  return {
    configured: concreteSecret || (health.configured && concreteEnv),
    tokenFileFingerprint: health.tokenFileFingerprint,
    tokenEnv: profile.tokenEnv,
    expectedFingerprint: health.expectedFingerprint,
    actualFingerprint: health.actualFingerprint,
    matchesExpected: health.matchesExpected,
    rotationRequired: health.rotationRequired,
    acl: health.acl,
  };
}

export function buildDesktopServiceSecretLeaseReceipt(input: {
  readonly profile: SavedProjectProfile | null;
  readonly state: DesktopServiceSecretState;
  readonly leaseOwner?: DesktopServiceSecretLeaseOwner | null;
}): DesktopServiceSecretLeaseReceipt {
  return {
    version: 'watcher-secret-lease-receipt/v1',
    tokenEnv: input.state.tokenEnv,
    tokenFileFingerprint: input.state.tokenFileFingerprint,
    secret: {
      configured: input.state.configured,
      expectedFingerprint: input.state.expectedFingerprint,
      actualFingerprint: input.state.actualFingerprint,
      matchesExpected: input.state.matchesExpected,
      rotationRequired: input.state.rotationRequired,
      aclRestricted: input.state.acl.restricted,
      aclReason: input.state.acl.reason,
    },
    leaseOwner: {
      projectFingerprint: fingerprintOrNull(input.leaseOwner?.projectId ?? input.profile?.id),
      instanceFingerprint: fingerprintOrNull(input.leaseOwner?.instanceId),
      leaseFingerprint: fingerprintOrNull(input.leaseOwner?.leaseId),
      hostFingerprint: fingerprintOrNull(input.leaseOwner?.hostname),
      rootFingerprint: fingerprintOrNull(input.leaseOwner?.root ?? input.profile?.root),
      serverFingerprint: fingerprintOrNull(input.leaseOwner?.server ?? input.profile?.serverUrl),
    },
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

function readProjectMcpBearerToken(profile: SavedProjectProfile): string | null {
  const path = join(profile.root, '.brain', 'mcp.json');
  return readMcpConfigBearerToken(path);
}

function readProjectConfigPackageBearerToken(profile: SavedProjectProfile): string | null {
  const path = join(profile.root, `${profile.id}-mcp-config.json`);
  return readMcpConfigBearerToken(path);
}

function readMcpConfigBearerToken(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return null;
    const server = parsed.mcpServers['project-brain'];
    if (!isRecord(server) || !isRecord(server.headers)) return null;
    const authorization = textValue(server.headers.Authorization) ?? textValue(server.headers.authorization);
    if (!authorization?.startsWith('Bearer ')) return null;
    const token = authorization.slice('Bearer '.length).trim();
    return isConcreteBearerToken(token) ? token : null;
  } catch (error) {
    console.warn(`Не удалось прочитать MCP config для переноса bearer: ${path}`, error);
    return null;
  }
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function fingerprintOrNull(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? buildRedactedSecretFingerprint(normalized) : null;
}
