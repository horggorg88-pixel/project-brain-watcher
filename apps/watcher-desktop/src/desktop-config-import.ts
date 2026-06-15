import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { ProjectDraft, ProjectImportResult } from './contracts.js';
import { saveDesktopAccessHandoff } from './desktop-access-handoff.js';
import { normalizeMcpServerUrl } from './desktop-mcp-endpoint.js';
import { saveProfile, type DesktopCorePaths } from './desktop-profile-store.js';
import { isConcreteBearerToken, stageDesktopServiceSecret } from './desktop-service-secret.js';

interface HandoffFile {
  readonly kind?: unknown;
  readonly project_id?: unknown;
  readonly local_path?: unknown;
  readonly endpoint?: unknown;
  readonly server_url?: unknown;
  readonly console_url?: unknown;
  readonly token_env?: unknown;
  readonly mcpServers?: unknown;
}

export function importProjectConfig(paths: DesktopCorePaths, sourcePath: string): ProjectImportResult {
  const parsed = parseHandoffFile(JSON.parse(readFileSync(sourcePath, 'utf-8')));
  const bearerToken = readBearerToken(parsed);
  if (isAccessConfig(parsed)) {
    const serverUrl = readAccessServerUrl(parsed);
    if (!serverUrl) throw new Error('Файл MCP-доступа должен содержать server_url или mcpServers.project-brain.url.');
    if (!bearerToken) throw new Error('Файл MCP-доступа должен содержать реальный Bearer-токен.');
    saveDesktopAccessHandoff(paths, {
      serverUrl,
      consoleUrl: readString(parsed.console_url),
      tokenEnv: readString(parsed.token_env) ?? 'MCP_BEARER_TOKEN',
      token: bearerToken,
    });
    return {
      profile: null,
      sourcePath,
      warnings: ['Личный MCP-доступ импортирован. Теперь выберите папку проекта, чтобы пульт создал проектный MCP-конфиг.'],
      tokenDetected: true,
      secretStaged: false,
      accessConfigImported: true,
    };
  }
  const project = toProjectDraft(parsed);
  const profile = saveProfile(paths, project);
  const secretStaged = bearerToken ? stageDesktopServiceSecret(profile, bearerToken).configured : false;
  return {
    profile,
    sourcePath,
    warnings: importWarnings(parsed, secretStaged),
    tokenDetected: bearerToken !== null,
    secretStaged,
    accessConfigImported: false,
  };
}

function isAccessConfig(file: HandoffFile): boolean {
  const kind = readString(file.kind);
  return kind === 'project-brain-access' || (!readString(file.project_id) && !readString(file.local_path) && readBearerToken(file) !== null);
}

function toProjectDraft(file: HandoffFile): ProjectDraft {
  const projectId = readString(file.project_id);
  const localPath = readString(file.local_path);
  const endpoint = readString(file.endpoint) ?? readServerUrl(file.mcpServers);
  const serverUrl = readString(file.server_url) ?? endpointToServer(endpoint, projectId);
  const consoleUrl = readString(file.console_url) ?? '';
  const tokenEnv = readString(file.token_env) ?? 'MCP_BEARER_TOKEN';
  if (!projectId || !localPath || !serverUrl) {
    throw new Error('Файл настройки MCP должен содержать project_id, local_path и endpoint/server_url.');
  }
  return {
    id: projectId,
    name: readableName(projectId),
    root: localPath,
    indexId: `idx-${projectId}`,
    serverUrl,
    consoleUrl,
    tokenEnv,
  };
}

function parseHandoffFile(value: unknown): HandoffFile {
  if (!isRecord(value)) throw new Error('Файл настройки MCP должен быть JSON-объектом.');
  return value;
}

function importWarnings(file: HandoffFile, secretStaged: boolean): string[] {
  const warnings: string[] = [];
  if (readBearerToken(file)) {
    warnings.push(secretStaged
      ? 'Bearer-токен перенесён в локальный secret-файл службы и не сохранён в профиле.'
      : 'Bearer-токен обнаружен в файле, но secret-файл службы не создан.');
  }
  if (!readString(file.token_env)) warnings.push('Имя переменной окружения не найдено, используется MCP_BEARER_TOKEN.');
  return warnings;
}

function readServerUrl(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const server = value['project-brain'];
  if (!isRecord(server)) return null;
  return readString(server.url);
}

function readAccessServerUrl(file: HandoffFile): string | null {
  const explicit = readString(file.server_url);
  if (explicit) return explicit;
  const serverUrl = readServerUrl(file.mcpServers);
  return endpointToServer(serverUrl, null);
}

function readBearerToken(file: HandoffFile): string | null {
  if (!isRecord(file.mcpServers)) return null;
  const server = file.mcpServers['project-brain'];
  if (!isRecord(server) || !isRecord(server.headers)) return null;
  const authorization = readString(server.headers.Authorization) ?? readString(server.headers.authorization);
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return isConcreteBearerToken(token) ? token : null;
}

function endpointToServer(endpoint: string | null, projectId: string | null): string | null {
  if (!endpoint) return null;
  const normalized = normalizeMcpServerUrl(endpoint);
  if (normalized) return normalized;
  const suffix = projectId ? `/mcp/p/${encodeURIComponent(projectId)}` : '/mcp';
  return endpoint.endsWith(suffix) ? endpoint.slice(0, -suffix.length) : endpoint.replace(/\/+$/, '');
}

function readableName(projectId: string): string {
  return projectId.split(/[-_]+/).filter(Boolean).map(capitalize).join(' ') || basename(projectId);
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
