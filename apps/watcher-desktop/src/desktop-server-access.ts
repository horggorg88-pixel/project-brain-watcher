import type { SavedProjectProfile } from './contracts.js';
import { buildProjectMcpEndpoint } from './desktop-mcp-endpoint.js';

export interface DesktopServerAccessVerification {
  readonly verified: boolean;
  readonly endpoint: string;
  readonly message: string;
}

const VERIFY_TIMEOUT_MS = 5_000;

export async function verifyProjectServerAccess(
  profile: SavedProjectProfile,
  token: string | null,
): Promise<DesktopServerAccessVerification> {
  const endpoint = buildProjectMcpEndpoint(profile.serverUrl, profile.id);
  if (!token) {
    return { verified: false, endpoint, message: 'Сервер MCP не подтвердил доступ: bearer secret не найден.' };
  }
  if (typeof fetch !== 'function') {
    return { verified: false, endpoint, message: 'Сервер MCP не подтвердил доступ: fetch недоступен в runtime.' };
  }
  try {
    const init = await fetchJsonRpc(endpoint, token, null, 1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'project-brain-watcher-desktop', version: '1.0.0' },
    });
    if (!init.ok) return denied(endpoint, init.status);
    const sessionId = init.headers.get('mcp-session-id');
    if (!sessionId) {
      return { verified: false, endpoint, message: 'Сервер MCP не подтвердил доступ: не выдал session id.' };
    }
    const tools = await fetchJsonRpc(endpoint, token, sessionId, 2, 'tools/list', {});
    if (!tools.ok) return denied(endpoint, tools.status);
    return { verified: true, endpoint, message: 'Сервер MCP подтвердил bearer secret и tools/list.' };
  } catch (error) {
    return {
      verified: false,
      endpoint,
      message: `Сервер MCP не подтвердил доступ: ${error instanceof Error ? error.message : 'ошибка проверки'}.`,
    };
  }
}

function denied(endpoint: string, status: number): DesktopServerAccessVerification {
  return {
    verified: false,
    endpoint,
    message: `Сервер MCP не подтвердил доступ: HTTP ${status}.`,
  };
}

async function fetchJsonRpc(
  endpoint: string,
  token: string,
  sessionId: string | null,
  id: number,
  method: string,
  params: Record<string, unknown>,
): Promise<Response> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  return fetchWithTimeout(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
}

async function fetchWithTimeout(endpoint: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    return await fetch(endpoint, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
