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
    'Работай только через MCP Project Brain для этого проекта.',
    `Проект: ${profile.id}`,
    `Локальный путь: ${profile.root}`,
    `MCP endpoint: ${endpoint}`,
    '',
    'Перед любым анализом вызови brain_status по этому project_id и local_path.',
    'Для файлов используй get_file_summary, для поиска search_code, для контекста get_context.',
    'Если включается режим wave, idol или другой MCP-режим, сначала подними runtime/policy contract, затем проходи gates и completion без досрочного завершения.',
    'Если route или session конфликтуют, используй reinitialize_project_route и только после успешного runtime_start продолжай работу.',
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
