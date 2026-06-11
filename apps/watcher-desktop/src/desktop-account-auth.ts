import type { AccessLoginRequest, McpConfigDiscovery, SavedProjectProfile } from './contracts.js';
import { normalizeMcpServerUrl } from './desktop-mcp-endpoint.js';
import { isConcreteBearerToken } from './desktop-service-secret.js';

const DEFAULT_ACCOUNT_SERVER_URL = 'http://149.33.14.250';
const AUTH_TIMEOUT_MS = 5_000;

export interface DesktopAccountAuthorization {
  readonly ok: boolean;
  readonly serverUrl: string | null;
  readonly bearerToken: string | null;
  readonly tokenEnv: string;
  readonly message: string;
}

export async function authorizeDesktopAccount(
  request: AccessLoginRequest,
  config: McpConfigDiscovery,
  profile: SavedProjectProfile | null,
): Promise<DesktopAccountAuthorization> {
  const serverUrl = resolveAccountServerUrl(config, profile);
  const endpoint = `${serverUrl}/api/auth/access`;
  if (typeof fetch !== 'function') return denied(serverUrl, 'Серверная авторизация недоступна в этом runtime.');
  try {
    const response = await fetchJson(endpoint, {
      firstName: '',
      lastName: '',
      email: request.email.trim().toLowerCase(),
      password: request.password,
      personalDataConsent: false,
    });
    const parsed = await parseAuthResponse(response);
    if (!response.ok || !parsed.ok) return denied(serverUrl, parsed.message);
    return parsed;
  } catch (error) {
    return denied(serverUrl, error instanceof Error ? error.message : 'ошибка авторизации');
  }
}

function resolveAccountServerUrl(config: McpConfigDiscovery, profile: SavedProjectProfile | null): string {
  const envUrl = typeof process.env.MCP_ONBOARDING_SERVER_URL === 'string'
    ? process.env.MCP_ONBOARDING_SERVER_URL
    : '';
  const base = config.serverUrl ?? profile?.serverUrl ?? envUrl ?? DEFAULT_ACCOUNT_SERVER_URL;
  return normalizeMcpServerUrl(base) || DEFAULT_ACCOUNT_SERVER_URL;
}

async function fetchJson(endpoint: string, body: Record<string, unknown>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    return await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function parseAuthResponse(response: Response): Promise<DesktopAccountAuthorization> {
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    return denied(null, `Сервер авторизации вернул HTTP ${response.status}.`);
  }
  if (!isRecord(parsed)) return denied(null, 'Сервер авторизации вернул неожиданный ответ.');
  if (parsed.ok !== true) {
    const message = typeof parsed.error === 'string' ? parsed.error : `Сервер авторизации вернул HTTP ${response.status}.`;
    return denied(null, message);
  }
  const serverConfig = isRecord(parsed.serverConfig) ? parsed.serverConfig : null;
  const serverUrl = readText(serverConfig?.serverUrl) ?? DEFAULT_ACCOUNT_SERVER_URL;
  const bearerToken = readText(serverConfig?.bearerToken);
  const tokenEnv = readText(serverConfig?.tokenEnv) ?? 'MCP_BEARER_TOKEN';
  if (!isConcreteBearerToken(bearerToken)) return denied(serverUrl, 'Сервер авторизации не выдал реальный bearer.');
  return {
    ok: true,
    serverUrl: normalizeMcpServerUrl(serverUrl) || DEFAULT_ACCOUNT_SERVER_URL,
    bearerToken: bearerToken.trim(),
    tokenEnv,
    message: 'Серверная авторизация подтверждена, bearer получен.',
  };
}

function denied(serverUrl: string | null, message: string): DesktopAccountAuthorization {
  return {
    ok: false,
    serverUrl: serverUrl ? normalizeMcpServerUrl(serverUrl) : null,
    bearerToken: null,
    tokenEnv: 'MCP_BEARER_TOKEN',
    message,
  };
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
