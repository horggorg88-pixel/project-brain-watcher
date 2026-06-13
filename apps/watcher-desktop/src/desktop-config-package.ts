import { basename } from 'node:path';
import type { DesktopConfigPackage, SavedProjectProfile } from './contracts.js';
import { readDesktopAccessHandoffToken } from './desktop-access-handoff.js';
import { projectBrainFilePaths, stageProjectBrainFiles } from './desktop-brain-bootstrap.js';
import { discoverMcpConfig } from './desktop-config-discovery.js';
import { buildProjectMcpEndpoint } from './desktop-mcp-endpoint.js';
import { applyMcpConfigToProfile, defaultProfile, readProfiles, type DesktopCorePaths } from './desktop-profile-store.js';
import {
  readDesktopServiceToken,
  readDesktopServiceSecretState,
  stageDesktopServiceSecret,
  syncDesktopServiceSecretFromProjectMcp,
} from './desktop-service-secret.js';

export function buildDesktopConfigPackage(
  paths: DesktopCorePaths,
  projectId: string,
  options: { readonly bootstrap?: boolean } = {},
): DesktopConfigPackage {
  const profile = resolveProfile(paths, projectId);
  const token = resolvePackageToken(paths, profile);
  const brainPaths = projectBrainFilePaths(profile);
  if (options.bootstrap) {
    if (!token) throw new Error(`Bearer для ${profile.tokenEnv} не найден. Войдите в пульт заново, затем скачайте пакет подключения.`);
    stageProjectBrainFiles(profile, { bearerToken: token });
  }
  const secret = readDesktopServiceSecretState(profile);
  const endpoint = buildProjectMcpEndpoint(profile.serverUrl, profile.id);
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
    brainDir: brainPaths.brainDir,
    brainConfigPath: brainPaths.configPath,
    brainMcpPath: brainPaths.mcpPath,
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
    'Лёгкая легенда MCP-режимов:',
    '- brain: привязка к project_id/local_path, route, карта проекта и MCP-only чтение.',
    '- watcher / service: локальный индексатор выбранного проекта; запускать из local_path проекта, а не из соседнего монорепо.',
    '- wave / wavy / вейви: operator_workflow:wave, несколько волн агентской проверки с evidence.',
    '- idol / идол: operator_workflow:idol, циклы wave + scorecard + NG+ gates + receipts. IDOL не внешняя шкала.',
    '- deep_analysis / глубокий анализ: read-only исследование с MCP evidence.',
    '- fix_loop / цикл фикс: read-only поиск причины до отдельного разрешения на правки.',
    '- review / ревью: проверка рисков, регрессий и дыр покрытия после изменений.',
    '- consultation / консультация: советы и анализ без проектных изменений.',
    '- active / делай: реализация после плана, с проверками и impact assessment.',
    '- council / консилиум: ролевое решение manager/architect/developer/reviewer.',
    '- swarm / рой: параллельные независимые задачи через watcher applier после estimate.',
    '- audit / аудит: study, survey, plan, implement; без реализации до approved plan.',
    '- refactor / рефактор: analyze-only, dry-run, apply with rollback.',
    '- todoist_sync: Brain remember перед Todoist comments/tasks.',
    '',
    'Если любой gate не прошёл, остановись и объясни, какое подключение нужно исправить. Не используй локальные правила как источник истины вместо MCP-контракта.',
  ].join('\n');
}

function maskToken(token: string): string {
  if (token.length <= 10) return '********';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function readableProjectName(root: string): string {
  return basename(root.trim()) || 'MCP project';
}

function resolvePackageToken(paths: DesktopCorePaths, profile: SavedProjectProfile): string | null {
  const serviceToken = readDesktopServiceToken(profile);
  if (serviceToken) return serviceToken;
  syncDesktopServiceSecretFromProjectMcp(profile);
  const packageToken = readDesktopServiceToken(profile);
  if (packageToken) return packageToken;
  const handoffToken = readDesktopAccessHandoffToken(paths);
  if (!handoffToken) return null;
  stageDesktopServiceSecret(profile, handoffToken);
  return handoffToken;
}
