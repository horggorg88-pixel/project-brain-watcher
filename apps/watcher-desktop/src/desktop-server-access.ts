import type { DesktopMcpIndexSnapshot, SavedProjectProfile } from './contracts.js';
import { buildProjectMcpEndpoint } from './desktop-mcp-endpoint.js';

export interface DesktopServerAccessVerification {
  readonly verified: boolean;
  readonly endpoint: string;
  readonly message: string;
  readonly mcpIndex?: DesktopMcpIndexSnapshot | null;
}

const VERIFY_TIMEOUT_MS = 5_000;
const MCP_INDEX_TTL_MS = 10 * 60 * 1000;

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
    const mcpIndex = await readMcpIndexSnapshot(endpoint, token, sessionId, profile);
    return { verified: true, endpoint, message: 'Сервер MCP подтвердил bearer secret и tools/list.', mcpIndex };
  } catch (error) {
    return {
      verified: false,
      endpoint,
      message: `Сервер MCP не подтвердил доступ: ${error instanceof Error ? error.message : 'ошибка проверки'}.`,
    };
  }
}

async function readMcpIndexSnapshot(
  endpoint: string,
  token: string,
  sessionId: string,
  profile: SavedProjectProfile,
): Promise<DesktopMcpIndexSnapshot | null> {
  const response = await fetchJsonRpc(endpoint, token, sessionId, 3, 'tools/call', {
    name: 'brain_status',
    arguments: {
      project_id: profile.id,
      local_path: profile.root,
      auto_activate: true,
    },
  });
  if (!response.ok) return null;
  const text = await response.text();
  return parseBrainStatusSnapshot(text);
}

function parseBrainStatusSnapshot(raw: string): DesktopMcpIndexSnapshot | null {
  const text = extractJsonRpcToolText(raw) ?? raw;
  const files = readRussianCount(text, 'Файлов');
  const symbols = readRussianCount(text, 'Символов');
  const embeddings = readRussianCount(text, 'Эмбеддинги');
  if (files === null || symbols === null || embeddings === null) return null;
  return {
    files,
    symbols,
    embeddings,
    checkedAt: new Date().toISOString(),
    staleAfterMs: MCP_INDEX_TTL_MS,
    source: 'mcp brain_status',
  };
}

function extractJsonRpcToolText(raw: string): string | null {
  for (const candidate of jsonCandidates(raw)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const text = toolTextFromJsonRpc(parsed);
      if (text) return text;
    } catch {
      // Ответ MCP может прийти как SSE, поэтому не каждый фрагмент обязан быть JSON.
    }
  }
  return null;
}

function jsonCandidates(raw: string): readonly string[] {
  const dataLines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
    .filter(line => line && line !== '[DONE]');
  return dataLines.length > 0 ? dataLines : [raw];
}

function toolTextFromJsonRpc(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const result = value['result'];
  if (!isRecord(result)) return null;
  const content = result['content'];
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (isRecord(item) && typeof item['text'] === 'string') return item['text'];
  }
  return null;
}

function readRussianCount(text: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`${escaped}\\s*:?\\s*(?:✅\\s*)?(\\d+)`, 'i'));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
