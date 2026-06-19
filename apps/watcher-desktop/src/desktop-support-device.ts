import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, platform, release, userInfo } from 'node:os';
import { join } from 'node:path';
import type { DesktopCorePaths } from './desktop-profile-store.js';
import type { DesktopAccountAuthorization } from './desktop-account-auth.js';
import type { ManagedDeviceEnrollment, ManagedDeviceStatus } from './contracts.js';
import { readDesktopAccessHandoff, readDesktopAccessHandoffToken } from './desktop-access-handoff.js';

const SUPPORT_STATE_FILE = 'desktop-support-device.json';
const SUPPORT_VERSION = '1.0.0';

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
      message: 'Support enrollment невозможен без активного bearer и supportBaseUrl.',
    };
  }
  const endpoint = `${account.supportBaseUrl}/api/support/devices/enroll`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${account.bearerToken}`,
    },
    body: JSON.stringify(buildEnrollmentPayload(paths, projectId, account.meshBaseUrl)),
  });
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(parsed) || parsed.ok !== true) {
    const message = isRecord(parsed) && typeof parsed.error === 'string'
      ? parsed.error
      : `Support enrollment вернул HTTP ${response.status}.`;
    return { enrolled: false, status: readManagedDeviceStatus(paths), message };
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

export async function enrollManagedDeviceFromHandoff(
  paths: DesktopCorePaths,
  projectId?: string,
): Promise<ManagedDeviceEnrollment> {
  const handoff = readDesktopAccessHandoff(paths);
  const bearerToken = readDesktopAccessHandoffToken(paths);
  if (!handoff || !bearerToken || !handoff.consoleUrl) {
    return {
      enrolled: false,
      status: readManagedDeviceStatus(paths),
      message: 'Личный handoff-token для support enrollment не найден.',
    };
  }
  return enrollManagedDevice(paths, {
    ok: true,
    serverUrl: handoff.serverUrl,
    consoleUrl: handoff.consoleUrl,
    supportBaseUrl: handoff.consoleUrl,
    meshBaseUrl: null,
    bearerToken,
    tokenEnv: handoff.tokenEnv,
    message: 'Личный handoff-token найден.',
  }, projectId);
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
    return isSupportDeviceState(parsed) ? parsed : null;
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
