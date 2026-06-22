import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, platform, release, userInfo } from 'node:os';
import { join } from 'node:path';
import type { DesktopCorePaths } from './desktop-profile-store.js';
import type { DesktopAccountAuthorization } from './desktop-account-auth.js';
import type { ManagedDeviceEnrollment, ManagedDeviceStatus, SavedProjectProfile } from './contracts.js';
import { readDesktopAccessHandoff, readDesktopAccessHandoffToken } from './desktop-access-handoff.js';
import { discoverMcpConfig } from './desktop-config-discovery.js';
import { normalizeMcpServerUrl } from './desktop-mcp-endpoint.js';
import { applyMcpConfigToProfile, defaultProfile, readProfiles } from './desktop-profile-store.js';
import { readDesktopServiceToken } from './desktop-service-secret.js';

const SUPPORT_STATE_FILE = 'desktop-support-device.json';
const SUPPORT_VERSION = '1.0.0';
const DEFAULT_MCP_SERVER_URL = 'http://149.33.14.250';
const DEFAULT_ACCOUNT_SERVER_URL = 'http://149.33.14.250:3020';

interface SupportDeviceState {
  readonly deviceId: string;
  readonly deviceToken: string;
  readonly supportBaseUrl: string;
  readonly meshUrl: string | null;
  readonly updatedAt: string;
}

export interface SupportDeviceCredentials {
  readonly deviceId: string;
  readonly deviceToken: string;
  readonly supportBaseUrl: string;
  readonly meshUrl: string | null;
}

export function readSupportDeviceCredentials(paths: DesktopCorePaths): SupportDeviceCredentials | null {
  const state = readSupportDeviceState(paths);
  return state
    ? {
      deviceId: state.deviceId,
      deviceToken: state.deviceToken,
      supportBaseUrl: state.supportBaseUrl,
      meshUrl: state.meshUrl,
    }
    : null;
}

export function readManagedDeviceStatus(paths: DesktopCorePaths): ManagedDeviceStatus {
  const state = readSupportDeviceState(paths);
  if (!state) {
    return {
      enrolled: false,
      health: 'not_enrolled',
      deviceId: null,
      supportBaseUrl: null,
      meshUrl: null,
      message: 'Support-устройство ещё не зарегистрировано.',
      updatedAt: null,
    };
  }
  return {
    enrolled: true,
    health: 'online',
    deviceId: state.deviceId,
    supportBaseUrl: state.supportBaseUrl,
    meshUrl: state.meshUrl,
    message: 'Support-устройство зарегистрировано и готово к heartbeat/jobs.',
    updatedAt: state.updatedAt,
  };
}

export async function enrollManagedDevice(
  paths: DesktopCorePaths,
  account: DesktopAccountAuthorization,
  projectId?: string,
): Promise<ManagedDeviceEnrollment> {
  if (!account.ok || !account.bearerToken || !account.supportBaseUrl) {
    return {
      enrolled: false,
      status: readManagedDeviceStatus(paths),
      message: `Support enrollment невозможен: bearer=${account.bearerToken ? 'есть' : 'нет'}, supportBaseUrl=${account.supportBaseUrl || 'нет данных'}.`,
    };
  }
  const endpoint = `${account.supportBaseUrl}/api/support/devices/enroll`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${account.bearerToken}`,
      },
      body: JSON.stringify(buildEnrollmentPayload(paths, projectId, account.meshBaseUrl)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      enrolled: false,
      status: readManagedDeviceStatus(paths),
      message: `Support enrollment request failed: POST ${endpoint}: ${message}`,
    };
  }
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(parsed) || parsed.ok !== true) {
    const message = isRecord(parsed) && typeof parsed.error === 'string'
      ? parsed.error
      : `Support enrollment вернул HTTP ${response.status}.`;
    const requestId = response.headers.get('x-request-id');
    const suffix = requestId ? ` requestId=${requestId}` : '';
    return {
      enrolled: false,
      status: readManagedDeviceStatus(paths),
      message: `Support enrollment failed: POST ${endpoint}: HTTP ${response.status}. ${message}${suffix}`,
    };
  }
  const device = isRecord(parsed.device) ? parsed.device : null;
  const deviceToken = typeof parsed.deviceToken === 'string' ? parsed.deviceToken : '';
  const deviceId = typeof device?.deviceId === 'string' ? device.deviceId : '';
  if (!deviceId || !deviceToken) {
    return {
      enrolled: false,
      status: readManagedDeviceStatus(paths),
      message: 'Support enrollment не вернул deviceId/deviceToken.',
    };
  }
  const state = saveSupportDeviceState(paths, {
    deviceId,
    deviceToken,
    supportBaseUrl: account.supportBaseUrl,
    meshUrl: typeof device?.meshUrl === 'string' ? device.meshUrl : null,
    updatedAt: new Date().toISOString(),
  });
  return { enrolled: true, status: toManagedDeviceStatus(state), message: 'Support-устройство зарегистрировано.' };
}

export async function ensureManagedDeviceEnrolled(
  paths: DesktopCorePaths,
  projectId?: string,
): Promise<ManagedDeviceEnrollment> {
  const existing = readManagedDeviceStatus(paths);
  if (existing.enrolled) {
    return {
      enrolled: true,
      status: existing,
      message: 'Support-устройство уже зарегистрировано.',
    };
  }
  const handoffAccount = accountFromHandoff(paths);
  if (handoffAccount) {
    const enrollment = await enrollManagedDevice(paths, handoffAccount, projectId);
    if (enrollment.enrolled) return enrollment;
  }
  const storedAccount = accountFromStoredProject(paths, projectId);
  if (!storedAccount) {
    return {
      enrolled: false,
      status: readManagedDeviceStatus(paths),
      message: 'Нет сохранённого bearer для автоматической support-регистрации.',
    };
  }
  return enrollManagedDevice(paths, storedAccount.account, storedAccount.projectId);
}

export async function enrollManagedDeviceFromHandoff(
  paths: DesktopCorePaths,
  projectId?: string,
): Promise<ManagedDeviceEnrollment> {
  const account = accountFromHandoff(paths);
  if (!account) {
    return {
      enrolled: false,
      status: readManagedDeviceStatus(paths),
      message: 'Личный handoff-token для support enrollment не найден.',
    };
  }
  return enrollManagedDevice(paths, account, projectId);
}

function accountFromHandoff(paths: DesktopCorePaths): DesktopAccountAuthorization | null {
  const handoff = readDesktopAccessHandoff(paths);
  const bearerToken = readDesktopAccessHandoffToken(paths);
  if (!handoff || !bearerToken || !handoff.consoleUrl) return null;
  const consoleUrl = clientBaseUrl(handoff.consoleUrl, DEFAULT_ACCOUNT_SERVER_URL);
  return {
    ok: true,
    serverUrl: handoff.serverUrl,
    consoleUrl,
    supportBaseUrl: consoleUrl,
    meshBaseUrl: null,
    bearerToken,
    tokenEnv: handoff.tokenEnv,
    message: 'Личный handoff-token найден.',
  };
}

function accountFromStoredProject(
  paths: DesktopCorePaths,
  projectId?: string,
): { readonly account: DesktopAccountAuthorization; readonly projectId?: string } | null {
  const config = discoverMcpConfig(paths);
  const profiles = readProfiles(paths);
  const profile = applyMcpConfigToProfile(
    resolveStoredProfile(paths, profiles, projectId ?? config.projectId ?? null),
    config,
  );
  if (!profile) return null;
  const bearerToken = readDesktopServiceToken(profile);
  if (!bearerToken) return null;
  const serverUrl = normalizeMcpServerUrl(profile.serverUrl || config.serverUrl || DEFAULT_MCP_SERVER_URL) || DEFAULT_MCP_SERVER_URL;
  const consoleUrl = clientBaseUrl(profile.consoleUrl || config.consoleUrl || defaultConsoleUrlFor(serverUrl), DEFAULT_ACCOUNT_SERVER_URL);
  return {
    projectId: profile.id,
    account: {
      ok: true,
      serverUrl,
      consoleUrl,
      supportBaseUrl: consoleUrl,
      meshBaseUrl: null,
      bearerToken,
      tokenEnv: profile.tokenEnv || config.tokenEnv || 'MCP_BEARER_TOKEN',
      message: 'Support enrollment восстановлен из сохранённого профиля проекта.',
    },
  };
}

function resolveStoredProfile(
  paths: DesktopCorePaths,
  profiles: readonly SavedProjectProfile[],
  projectId: string | null,
): SavedProjectProfile | null {
  if (projectId) {
    const matched = profiles.find(profile => profile.id === projectId);
    if (matched) return matched;
  }
  return profiles[0] ?? defaultProfile(paths);
}

function defaultConsoleUrlFor(serverUrl: string): string {
  return normalizeMcpServerUrl(serverUrl) === DEFAULT_MCP_SERVER_URL ? DEFAULT_ACCOUNT_SERVER_URL : '';
}

function clientBaseUrl(value: string, fallback: string): string {
  const normalized = normalizeMcpServerUrl(value);
  const normalizedFallback = normalizeMcpServerUrl(fallback) || DEFAULT_ACCOUNT_SERVER_URL;
  if (!normalized || isLocalBindUrl(normalized)) return normalizedFallback;
  return normalized;
}

function isLocalBindUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return (
      host === '0.0.0.0'
      || host === '::'
      || host === '[::]'
      || host === 'localhost'
      || host === '127.0.0.1'
      || host.startsWith('127.')
    );
  } catch {
    return false;
  }
}

function buildEnrollmentPayload(
  paths: DesktopCorePaths,
  projectId: string | undefined,
  meshBaseUrl: string | null,
): Record<string, string> {
  const host = hostname() || 'unknown-host';
  const installId = `${userInfo().username}@${host}:${paths.userDataPath}`;
  return {
    label: projectId ? `${projectId} · ${host}` : host,
    hostname: host,
    os: `${platform()} ${release()}`,
    appVersion: process.env.npm_package_version ?? 'desktop',
    supportVersion: SUPPORT_VERSION,
    installId,
    meshUrl: meshBaseUrl ? `${meshBaseUrl.replace(/\/$/, '')}/device/${encodeURIComponent(host)}` : '',
  };
}

function saveSupportDeviceState(
  paths: DesktopCorePaths,
  state: SupportDeviceState,
): SupportDeviceState {
  mkdirSync(paths.userDataPath, { recursive: true });
  writeFileSync(statePath(paths), JSON.stringify(state, null, 2), 'utf-8');
  return state;
}

function readSupportDeviceState(paths: DesktopCorePaths): SupportDeviceState | null {
  const path = statePath(paths);
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return isSupportDeviceState(parsed) && !isLocalBindUrl(parsed.supportBaseUrl) ? parsed : null;
  } catch {
    return null;
  }
}

function toManagedDeviceStatus(state: SupportDeviceState): ManagedDeviceStatus {
  return {
    enrolled: true,
    health: 'online',
    deviceId: state.deviceId,
    supportBaseUrl: state.supportBaseUrl,
    meshUrl: state.meshUrl,
    message: 'Support-устройство зарегистрировано и готово к heartbeat/jobs.',
    updatedAt: state.updatedAt,
  };
}

function statePath(paths: DesktopCorePaths): string {
  return join(paths.userDataPath, SUPPORT_STATE_FILE);
}

function isSupportDeviceState(value: unknown): value is SupportDeviceState {
  return (
    isRecord(value)
    && typeof value.deviceId === 'string'
    && typeof value.deviceToken === 'string'
    && typeof value.supportBaseUrl === 'string'
    && (typeof value.meshUrl === 'string' || value.meshUrl === null)
    && typeof value.updatedAt === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
