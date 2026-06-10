import { basename } from 'node:path';
import type { DesktopConfigPackage, SavedProjectProfile } from './contracts.js';
import { discoverMcpConfig } from './desktop-config-discovery.js';
import { applyMcpConfigToProfile, defaultProfile, readProfiles, type DesktopCorePaths } from './desktop-profile-store.js';
import {
  readDesktopServiceToken,
  readDesktopServiceSecretState,
} from './desktop-service-secret.js';

export function buildDesktopConfigPackage(paths: DesktopCorePaths, projectId: string): DesktopConfigPackage {
  const profile = resolveProfile(paths, projectId);
  const token = readDesktopServiceToken(profile);
  const secret = readDesktopServiceSecretState(profile);
  const endpoint = projectMcpEndpoint(profile);
  const prompt = buildStartPrompt(profile, endpoint);
  const payload = {
    mcpServers: {
      'project-brain': {
        type: 'http',
        url: endpoint,
        headers: {
          Authorization: token ? `Bearer ${token}` : `Bearer ${profile.tokenEnv}`,
        },
      },
    },
    projectBrain: {
      projectId: profile.id,
      localPath: profile.root,
      indexId: profile.indexId,
      tokenEnv: profile.tokenEnv,
      startPrompt: prompt,
    },
  };
  return {
    projectId: profile.id,
    fileName: `${profile.id}-mcp-config.json`,
    configJson: JSON.stringify(payload, null, 2),
    prompt,
    tokenEnv: profile.tokenEnv,
    tokenAvailable: Boolean(token),
    tokenPreview: token ? maskToken(token) : `${profile.tokenEnv} не найден`,
    tokenValue: token,
    secretPath: secret.tokenFilePath,
  };
}

function resolveProfile(paths: DesktopCorePaths, projectId: string): SavedProjectProfile {
  const profiles = readProfiles(paths);
  const requested = profiles.find(profile => profile.id === projectId);
  const fallback = applyMcpConfigToProfile(requested ?? profiles[0] ?? defaultProfile(paths), discoverMcpConfig(paths));
  if (!fallback) throw new Error('Проект не выбран. Сначала выберите папку проекта.');
  return fallback;
}

function buildStartPrompt(profile: SavedProjectProfile, endpoint: string): string {
  return [
    'BRAIN ON — Brain MCP bootstrap',
    '',
    'Работай только через MCP project-brain. MCP-конфиг является единственным источником project_id, local_path, endpoint и ключа.',
    `Текущий project_id из MCP-файла: ${profile.id}`,
    `Текущий local_path из MCP-файла: ${profile.root}`,
    `MCP endpoint: ${endpoint}`,
    `1. Сначала вызови brain_status(project_id="${profile.id}", local_path="${profile.root}").`,
    '2. Если активный route указывает на другой проект или появился project_route_conflict, вызови reinitialize_project_route(project_id, local_path).',
    '3. После успешного route вызови runtime_start и получи runtime_session_id, policy_session_id, policy_hash и policy_context_pack.',
    '4. Любой режим запускай только через policy_workflow / operator_workflow и передавай runtime_session_id + policy_context_pack.',
    '5. Для чтения проекта используй project_map, get_context, search_code, get_file_summary, find_symbol и dependency_graph.',
    '6. Не читай файлы напрямую и не продолжай работу, если brain_status, route или runtime/policy gate не прошли.',
    '',
    'Если любой gate не прошёл, остановись и объясни, какое подключение нужно исправить. Не используй локальные правила как источник истины вместо MCP-контракта.',
  ].join('\n');
}

function projectMcpEndpoint(profile: SavedProjectProfile): string {
  const base = profile.serverUrl.trim().replace(/\/$/, '');
  const projectId = encodeURIComponent(profile.id);
  if (/\/mcp\/p\/[^/]+$/.test(base)) return base;
  if (base.endsWith('/mcp')) return `${base}/p/${projectId}`;
  return `${base}/mcp/p/${projectId}`;
}

function maskToken(token: string): string {
  if (token.length <= 10) return '********';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function readableProjectName(root: string): string {
  return basename(root.trim()) || 'MCP project';
}
