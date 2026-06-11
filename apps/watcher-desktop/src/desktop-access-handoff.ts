import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpConfigDiscovery, SavedProjectProfile } from './contracts.js';
import { normalizeMcpServerUrl } from './desktop-mcp-endpoint.js';
import type { DesktopCorePaths } from './desktop-profile-store.js';
import { isConcreteBearerToken, stageDesktopServiceSecret } from './desktop-service-secret.js';
import {
  buildRedactedSecretFingerprint,
  readRestrictedSecretFile,
  writeRestrictedSecretFile,
} from './secure-secret-file.js';

export interface DesktopAccessHandoffInput {
  readonly serverUrl: string;
  readonly tokenEnv: string;
  readonly token: string;
}

export interface DesktopAccessHandoff {
  readonly serverUrl: string;
  readonly tokenEnv: string;
  readonly tokenFingerprint: string;
  readonly importedAt: string;
}

export function saveDesktopAccessHandoff(
  paths: DesktopCorePaths,
  input: DesktopAccessHandoffInput,
): DesktopAccessHandoff {
  const tokenEnv = normalizeTokenEnv(input.tokenEnv);
  const serverUrl = normalizeMcpServerUrl(input.serverUrl);
  if (!serverUrl) throw new Error('Личный MCP-доступ должен содержать server_url.');
  if (!isConcreteBearerToken(input.token)) throw new Error('Личный MCP-доступ должен содержать реальный Bearer-токен.');
  const handoff = {
    serverUrl,
    tokenEnv,
    tokenFingerprint: buildRedactedSecretFingerprint(input.token),
    importedAt: new Date().toISOString(),
  };
  mkdirSync(paths.userDataPath, { recursive: true });
  writeRestrictedSecretFile(accessTokenPath(paths, tokenEnv), input.token);
  writeFileSync(accessHandoffPath(paths), JSON.stringify(handoff, null, 2), 'utf-8');
  return handoff;
}

export function readDesktopAccessHandoff(paths: DesktopCorePaths): DesktopAccessHandoff | null {
  const path = accessHandoffPath(paths);
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return toDesktopAccessHandoff(parsed);
  } catch {
    return null;
  }
}

export function readDesktopAccessHandoffToken(paths: DesktopCorePaths): string | null {
  const handoff = readDesktopAccessHandoff(paths);
  if (!handoff) return null;
  const token = readRestrictedSecretFile(accessTokenPath(paths, handoff.tokenEnv));
  return isConcreteBearerToken(token) ? token.trim() : null;
}

export function stageDesktopAccessHandoffForProfile(
  paths: DesktopCorePaths,
  profile: SavedProjectProfile,
): boolean {
  const token = readDesktopAccessHandoffToken(paths);
  if (!token) return false;
  return stageDesktopServiceSecret(profile, token).configured;
}

export function discoverDesktopAccessHandoff(paths: DesktopCorePaths): McpConfigDiscovery | null {
  const handoff = readDesktopAccessHandoff(paths);
  if (!handoff) return null;
  return {
    found: true,
    source: 'generic',
    configPath: accessHandoffPath(paths),
    serverUrl: handoff.serverUrl,
    tokenEnv: handoff.tokenEnv,
    projectId: null,
    localPath: null,
    findings: ['Личный MCP-доступ найден в локальном пульте'],
  };
}

function toDesktopAccessHandoff(value: unknown): DesktopAccessHandoff | null {
  if (!isRecord(value)) return null;
  const serverUrl = typeof value.serverUrl === 'string' ? normalizeMcpServerUrl(value.serverUrl) : '';
  const tokenEnv = typeof value.tokenEnv === 'string' ? normalizeTokenEnv(value.tokenEnv) : 'MCP_BEARER_TOKEN';
  if (!serverUrl) return null;
  if (typeof value.tokenFingerprint !== 'string' || !value.tokenFingerprint.startsWith('sha256:')) return null;
  return {
    serverUrl,
    tokenEnv,
    tokenFingerprint: value.tokenFingerprint,
    importedAt: typeof value.importedAt === 'string' ? value.importedAt : new Date(0).toISOString(),
  };
}

function accessHandoffPath(paths: DesktopCorePaths): string {
  return join(paths.userDataPath, 'desktop-access-handoff.json');
}

function accessTokenPath(paths: DesktopCorePaths, tokenEnv: string): string {
  return join(paths.userDataPath, 'desktop-access', `${safeFileName(tokenEnv)}.secret`);
}

function normalizeTokenEnv(value: string): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : 'MCP_BEARER_TOKEN';
}

function safeFileName(value: string): string {
  return normalizeTokenEnv(value).replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
