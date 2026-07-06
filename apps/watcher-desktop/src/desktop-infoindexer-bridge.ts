import type {
  DesktopInfoIndexerToolCallRequest,
  DesktopInfoIndexerToolName,
  DesktopInfoIndexerToolResult,
  DesktopJsonObject,
  DesktopJsonValue,
  SavedProjectProfile,
} from './contracts.js';
import {
  isDesktopJsonObject,
  normalizeDesktopInfoIndexerRequest,
  readDesktopInfoIndexerProjectId,
} from './desktop-infoindexer-request.js';
import { buildProjectMcpEndpoint, normalizeMcpServerUrl } from './desktop-mcp-endpoint.js';
import { discoverMcpConfig } from './desktop-config-discovery.js';
import { applyMcpConfigToProfile, type DesktopCorePaths } from './desktop-profile-store.js';
import { readDesktopServiceToken } from './desktop-service-secret.js';
import { resolveServiceProfile } from './desktop-service-status.js';

const TOOL_CALL_TIMEOUT_MS = 15_000;

export async function callDesktopInfoIndexerTool(
  paths: DesktopCorePaths,
  input: unknown,
): Promise<DesktopInfoIndexerToolResult> {
  const request = normalizeDesktopInfoIndexerRequest(input);
  if (!request) {
    return localBridgeError('infoindexer.search_companies', readDesktopInfoIndexerProjectId(input), null, 'Запрос InfoIndexer bridge отклонён: неизвестный инструмент.');
  }
  const profile = resolveInfoIndexerProfile(paths, request.projectId);
  if (!profile) return localBridgeError(request.tool, null, null, 'Профиль проекта InfoIndexer не найден.');
  const endpoint = buildToolsCallEndpoint(profile);
  if (!endpoint) return localBridgeError(request.tool, profile.id, null, 'Server URL проекта не настроен.');
  const token = readDesktopServiceToken(profile);
  if (!token) return localBridgeError(request.tool, profile.id, endpoint, `Bearer для ${profile.tokenEnv} не найден.`);
  if (typeof fetch !== 'function') {
    return localBridgeError(request.tool, profile.id, endpoint, 'Fetch недоступен в desktop runtime.');
  }

  try {
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ tool: request.tool, arguments: buildToolArguments(request) }),
    });
    return await resultFromResponse(request.tool, profile.id, endpoint, response);
  } catch (error) {
    return localBridgeError(request.tool, profile.id, endpoint, bridgeErrorMessage(error));
  }
}

function resolveInfoIndexerProfile(paths: DesktopCorePaths, projectId: string): SavedProjectProfile | null {
  const config = discoverMcpConfig(paths);
  return applyMcpConfigToProfile(resolveServiceProfile(paths, projectId), config);
}

function buildToolsCallEndpoint(profile: SavedProjectProfile): string {
  const base = normalizeMcpServerUrl(buildProjectMcpEndpoint(profile.serverUrl, profile.id));
  return base ? `${base}/api/tools/call` : '';
}

function buildToolArguments(request: DesktopInfoIndexerToolCallRequest): DesktopJsonObject {
  if (request.tool === 'infoindexer.health') {
    return { project_id: request.projectId };
  }
  if (request.tool === 'infoindexer.search_companies') {
    return compactObject({
      project_id: request.projectId,
      query: request.query,
      page: request.page,
      limit: request.limit,
      projection: request.projection,
      filters: request.filters,
      sort: request.sort,
    });
  }
  if (request.tool === 'infoindexer.get_company') {
    return compactObject({
      project_id: request.projectId,
      company_id: request.companyId,
      inn: request.inn,
      ogrn: request.ogrn,
      sections: request.sections,
    });
  }
  if (request.tool === 'infoindexer.job_status') {
    return compactObject({
      project_id: request.projectId,
      job_id: request.jobId,
    });
  }
  return compactObject({
    project_id: request.projectId,
    source: request.source,
    mode: request.mode,
    idempotency_key: request.idempotencyKey,
  });
}

async function resultFromResponse(
  tool: DesktopInfoIndexerToolName,
  projectId: string,
  endpoint: string,
  response: Response,
): Promise<DesktopInfoIndexerToolResult> {
  const parsed = await parseJsonResponse(response);
  const ok = readBoolean(parsed, 'ok') ?? response.ok;
  return {
    ok,
    content: readString(parsed, 'content') ?? response.statusText,
    structuredContent: readJsonObject(parsed, 'structuredContent'),
    isError: readBoolean(parsed, 'isError') ?? !response.ok,
    status: response.status,
    cacheControl: response.headers.get('Cache-Control'),
    endpoint,
    projectId,
    tool,
  };
}

async function parseJsonResponse(response: Response): Promise<DesktopJsonObject | null> {
  try {
    const parsed = await response.json() as unknown;
    return isDesktopJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(endpoint: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOOL_CALL_TIMEOUT_MS);
  try {
    return await fetch(endpoint, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function compactObject(values: Record<string, DesktopJsonValue | undefined>): DesktopJsonObject {
  const result: Record<string, DesktopJsonValue> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function localBridgeError(
  tool: DesktopInfoIndexerToolName,
  projectId: string | null,
  endpoint: string | null,
  content: string,
): DesktopInfoIndexerToolResult {
  return {
    ok: false,
    content,
    structuredContent: {
      status: 'blocked',
      project_id: projectId,
      required_next: 'configure_desktop_infoindexer_bridge',
    },
    isError: true,
    status: 0,
    cacheControl: null,
    endpoint,
    projectId,
    tool,
  };
}

function bridgeErrorMessage(error: unknown): string {
  if (!isErrorLike(error)) return 'Ошибка вызова InfoIndexer bridge.';
  if (error.name === 'AbortError' || /aborted/i.test(error.message)) {
    return `Таймаут InfoIndexer bridge ${TOOL_CALL_TIMEOUT_MS} мс.`;
  }
  return error.message || 'Ошибка вызова InfoIndexer bridge.';
}

function readString(value: DesktopJsonObject | null, key: string): string | null {
  const item = value?.[key];
  return typeof item === 'string' ? item : null;
}

function readBoolean(value: DesktopJsonObject | null, key: string): boolean | null {
  const item = value?.[key];
  return typeof item === 'boolean' ? item : null;
}

function readNumber(value: DesktopJsonObject | null, key: string): number | undefined {
  const item = value?.[key];
  return typeof item === 'number' && Number.isFinite(item) ? item : undefined;
}

function readJsonObject(value: DesktopJsonObject | null, key: string): DesktopJsonObject | null {
  const item = value?.[key];
  return isDesktopJsonObject(item) ? item : null;
}

function isErrorLike(value: unknown): value is { readonly name?: string; readonly message: string } {
  return typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string';
}
