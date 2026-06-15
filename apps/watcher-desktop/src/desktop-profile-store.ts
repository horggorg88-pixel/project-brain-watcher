import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpConfigDiscovery, ProjectDraft, SavedProjectProfile } from './contracts.js';
import { readDesktopAccessHandoff, stageDesktopAccessHandoffForProfile } from './desktop-access-handoff.js';
import { stageProjectBrainFiles } from './desktop-brain-bootstrap.js';
import { normalizeMcpServerUrl } from './desktop-mcp-endpoint.js';
import { readDesktopServiceToken } from './desktop-service-secret.js';

export interface DesktopCorePaths {
  readonly homePath: string;
  readonly userDataPath: string;
}

export function readProfiles(paths: DesktopCorePaths): readonly SavedProjectProfile[] {
  const path = profilesPath(paths);
  if (!existsSync(path)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return Array.isArray(parsed) ? parsed.flatMap(toSavedProfile) : [];
  } catch {
    return [];
  }
}

export function saveProfile(paths: DesktopCorePaths, project: ProjectDraft): SavedProjectProfile {
  const handoff = readDesktopAccessHandoff(paths);
  const serverUrl = project.serverUrl.trim() || handoff?.serverUrl || '';
  const consoleUrl = project.consoleUrl?.trim() || handoff?.consoleUrl || '';
  const tokenEnv = project.tokenEnv.trim() || handoff?.tokenEnv || 'MCP_BEARER_TOKEN';
  const normalized = normalizeProject({
    ...project,
    serverUrl,
    consoleUrl,
    tokenEnv,
  });
  const profiles = readProfiles(paths).filter(item => item.id !== normalized.id);
  const saved = { ...normalized, createdAt: new Date().toISOString() };
  mkdirSync(paths.userDataPath, { recursive: true });
  writeFileSync(profilesPath(paths), JSON.stringify([...profiles, saved], null, 2), 'utf-8');
  stageDesktopAccessHandoffForProfile(paths, saved);
  stageProjectBrainFiles(saved, { bearerToken: readDesktopServiceToken(saved) });
  return saved;
}

export function defaultProfile(paths: DesktopCorePaths): SavedProjectProfile | null {
  const root = join(paths.homePath, 'Desktop', 'MCP');
  if (!existsSync(root)) return null;
  return {
    id: 'mcp-monorepo',
    name: 'MCP Monorepo',
    root,
    indexId: 'idx-mcp-monorepo',
    serverUrl: '',
    consoleUrl: '',
    tokenEnv: 'MCP_BEARER_TOKEN',
    createdAt: new Date(0).toISOString(),
  };
}

export function applyMcpConfigToProfile(
  profile: SavedProjectProfile | null,
  config: McpConfigDiscovery,
): SavedProjectProfile | null {
  if (!profile) return null;
  return {
    ...profile,
    serverUrl: profile.serverUrl || normalizeMcpServerUrl(config.serverUrl ?? ''),
    consoleUrl: profile.consoleUrl || normalizeMcpServerUrl(config.consoleUrl ?? ''),
    tokenEnv: profile.tokenEnv || config.tokenEnv || 'MCP_BEARER_TOKEN',
  };
}

export function serviceExePath(profile: SavedProjectProfile): string {
  return join(profile.root, '.brain', 'service', `${serviceName(profile.id)}.exe`);
}

export function serviceName(projectId: string): string {
  const slug = projectId.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `ProjectBrainWatcher-${slug || 'default'}`;
}

function profilesPath(paths: DesktopCorePaths): string {
  return join(paths.userDataPath, 'project-profiles.json');
}

function normalizeProject(project: ProjectDraft): ProjectDraft {
  const normalized = {
    id: project.id.trim(),
    name: project.name.trim(),
    root: project.root.trim(),
    indexId: project.indexId.trim(),
    serverUrl: normalizeMcpServerUrl(project.serverUrl),
    consoleUrl: normalizeMcpServerUrl(project.consoleUrl ?? ''),
    tokenEnv: project.tokenEnv.trim() || 'MCP_BEARER_TOKEN',
  };
  if (!normalized.id || !normalized.name || !normalized.root || !normalized.indexId) {
    throw new Error('ID, название, путь и ID индекса обязательны');
  }
  return normalized;
}

function toSavedProfile(value: unknown): SavedProjectProfile[] {
  if (!isRecord(value)) return [];
  const draft = {
    id: typeof value.id === 'string' ? value.id : '',
    name: typeof value.name === 'string' ? value.name : '',
    root: typeof value.root === 'string' ? value.root : '',
    indexId: typeof value.indexId === 'string' ? value.indexId : '',
    serverUrl: typeof value.serverUrl === 'string' ? value.serverUrl : '',
    consoleUrl: typeof value.consoleUrl === 'string' ? value.consoleUrl : '',
    tokenEnv: typeof value.tokenEnv === 'string' ? value.tokenEnv : 'MCP_BEARER_TOKEN',
  };
  try {
    const createdAt = typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString();
    return [{ ...normalizeProject(draft), createdAt }];
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
