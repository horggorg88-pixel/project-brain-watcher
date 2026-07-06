import type {
  DesktopInfoIndexerToolCallRequest,
  DesktopInfoIndexerToolName,
  DesktopJsonObject,
  DesktopJsonValue,
} from './contracts.js';

const INFOINDEXER_TOOLS: readonly DesktopInfoIndexerToolName[] = [
  'infoindexer.health',
  'infoindexer.search_companies',
  'infoindexer.get_company',
  'infoindexer.job_status',
  'infoindexer.start_ingest',
];

export function normalizeDesktopInfoIndexerRequest(input: unknown): DesktopInfoIndexerToolCallRequest | null {
  if (!isDesktopJsonObject(input)) return null;
  const tool = readInfoIndexerTool(input);
  const projectId = readString(input, 'projectId') ?? '';
  if (!tool || !projectId) return null;
  if (tool === 'infoindexer.health') return { tool, projectId };
  if (tool === 'infoindexer.search_companies') return normalizeSearchRequest(input, projectId);
  if (tool === 'infoindexer.get_company') return normalizeCompanyRequest(input, projectId);
  if (tool === 'infoindexer.job_status') {
    return { tool, projectId, jobId: readString(input, 'jobId') ?? '' };
  }
  return {
    tool,
    projectId,
    source: readString(input, 'source') ?? undefined,
    mode: readString(input, 'mode') ?? undefined,
    idempotencyKey: readString(input, 'idempotencyKey') ?? undefined,
  };
}

export function readDesktopInfoIndexerProjectId(input: unknown): string | null {
  return isDesktopJsonObject(input) && typeof input.projectId === 'string' ? input.projectId : null;
}

export function isDesktopJsonObject(value: unknown): value is DesktopJsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(isDesktopJsonValue);
}

function normalizeSearchRequest(value: DesktopJsonObject, projectId: string): DesktopInfoIndexerToolCallRequest {
  return {
    tool: 'infoindexer.search_companies',
    projectId,
    query: readString(value, 'query') ?? '',
    page: readNumber(value, 'page'),
    limit: readNumber(value, 'limit'),
    projection: readString(value, 'projection') === 'compact' ? 'compact' : undefined,
    filters: readJsonObject(value, 'filters') ?? undefined,
    sort: readJsonObject(value, 'sort') ?? undefined,
  };
}

function normalizeCompanyRequest(value: DesktopJsonObject, projectId: string): DesktopInfoIndexerToolCallRequest {
  return {
    tool: 'infoindexer.get_company',
    projectId,
    companyId: readString(value, 'companyId') ?? undefined,
    inn: readString(value, 'inn') ?? undefined,
    ogrn: readString(value, 'ogrn') ?? undefined,
    sections: readStringArray(value, 'sections'),
  };
}

function readInfoIndexerTool(value: DesktopJsonObject): DesktopInfoIndexerToolName | null {
  const tool = value.tool;
  if (typeof tool !== 'string') return null;
  for (const item of INFOINDEXER_TOOLS) {
    if (item === tool) return item;
  }
  return null;
}

function readString(value: DesktopJsonObject | null, key: string): string | null {
  const item = value?.[key];
  return typeof item === 'string' ? item : null;
}

function readNumber(value: DesktopJsonObject | null, key: string): number | undefined {
  const item = value?.[key];
  return typeof item === 'number' && Number.isFinite(item) ? item : undefined;
}

function readJsonObject(value: DesktopJsonObject | null, key: string): DesktopJsonObject | null {
  const item = value?.[key];
  return isDesktopJsonObject(item) ? item : null;
}

function readStringArray(value: DesktopJsonObject | null, key: string): readonly string[] | undefined {
  const item = value?.[key];
  return Array.isArray(item) && item.every(entry => typeof entry === 'string') ? item : undefined;
}

function isDesktopJsonValue(value: unknown): value is DesktopJsonValue {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isDesktopJsonValue);
  return isDesktopJsonObject(value);
}
