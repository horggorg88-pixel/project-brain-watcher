import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { McpConfigDiscovery, McpConfigSource } from './contracts.js';
import { discoverDesktopAccessHandoff } from './desktop-access-handoff.js';
import { normalizeMcpServerUrl } from './desktop-mcp-endpoint.js';
import { readProfiles, type DesktopCorePaths } from './desktop-profile-store.js';

const CODEX_CONFIG = join('.codex', 'config.toml');
const CLAUDE_CONFIG = join('AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
const CURSOR_CONFIG = join('AppData', 'Roaming', 'Cursor', 'User', 'mcp.json');

export function discoverMcpConfig(paths: DesktopCorePaths): McpConfigDiscovery {
  const candidates = [
    readSavedProfileConfig(paths),
    discoverDesktopAccessHandoff(paths),
    readCodexConfig(join(paths.homePath, CODEX_CONFIG)),
    readJsonConfig('claude', join(paths.homePath, CLAUDE_CONFIG)),
    readJsonConfig('cursor', join(paths.homePath, CURSOR_CONFIG)),
  ].filter((candidate): candidate is McpConfigDiscovery => candidate !== null);
  return candidates.find(candidate => candidate.found) ?? missingConfig(paths);
}

function readSavedProfileConfig(paths: DesktopCorePaths): McpConfigDiscovery {
  const profile = readProfiles(paths)[0];
  if (!profile) return notFound('generic', join(paths.userDataPath, 'project-profiles.json'));
  return {
    found: true,
    source: 'generic',
    configPath: join(paths.userDataPath, 'project-profiles.json'),
    serverUrl: profile.serverUrl || null,
    consoleUrl: profile.consoleUrl || null,
    tokenEnv: profile.tokenEnv,
    projectId: profile.id,
    localPath: profile.root,
    findings: ['Импортированный профиль MCP найден в локальном пульте'],
  };
}

function readCodexConfig(path: string): McpConfigDiscovery {
  if (!existsSync(path)) return notFound('codex', path);
  let content = '';
  try {
    content = readFileSync(path, 'utf-8');
  } catch (error) {
    return notFound('codex', `${path}: ${errorMessage(error)}`);
  }
  const server = readTomlProjectBrainServer(content);
  if (!server) return notFound('codex', path);
  return {
    found: true,
    source: 'codex',
    configPath: path,
    serverUrl: normalizeServerUrl(server.url),
    consoleUrl: null,
    tokenEnv: server.tokenEnv,
    projectId: null,
    localPath: null,
    findings: ['Codex MCP server project-brain найден'],
  };
}

function readJsonConfig(source: Exclude<McpConfigSource, 'codex' | 'generic' | 'none'>, path: string): McpConfigDiscovery {
  if (!existsSync(path)) return notFound(source, path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    return notFound(source, `${path}: ${errorMessage(error)}`);
  }
  const server = readProjectBrainServer(parsed);
  if (!server) return notFound(source, path);
  return {
    found: true,
    source,
    configPath: path,
    serverUrl: normalizeServerUrl(server.url),
    consoleUrl: normalizeServerUrl(server.consoleUrl),
    tokenEnv: server.tokenEnv,
    projectId: server.projectId,
    localPath: server.localPath,
    findings: [`${source} MCP server project-brain найден`],
  };
}

function readProjectBrainServer(value: unknown): {
  readonly url: string | null;
  readonly consoleUrl: string | null;
  readonly tokenEnv: string | null;
  readonly projectId: string | null;
  readonly localPath: string | null;
} | null {
  if (!isRecord(value) || !isRecord(value.mcpServers)) return null;
  const server = value.mcpServers['project-brain'];
  if (!isRecord(server)) return null;
  const args = Array.isArray(server.args) ? server.args.filter(isString) : [];
  return {
    url: typeof server.url === 'string' ? server.url : findArgValue(args, '--server'),
    consoleUrl: typeof value.console_url === 'string' ? value.console_url : null,
    tokenEnv: findArgValue(args, '--token-env') ?? findArgValue(args, '--tokenEnv'),
    projectId: findArgValue(args, '--project'),
    localPath: findArgValue(args, '--path'),
  };
}

function missingConfig(paths: DesktopCorePaths): McpConfigDiscovery {
  return {
    found: false,
    source: 'none',
    configPath: null,
    serverUrl: null,
    consoleUrl: null,
    tokenEnv: null,
    projectId: null,
    localPath: null,
    findings: [
      `Не найден ${join(paths.homePath, CODEX_CONFIG)}`,
      `Не найден ${join(paths.homePath, CLAUDE_CONFIG)}`,
      `Не найден ${join(paths.homePath, CURSOR_CONFIG)}`,
    ],
  };
}

function notFound(source: Exclude<McpConfigSource, 'none'>, path: string): McpConfigDiscovery {
  return {
    found: false,
    source,
    configPath: path,
    serverUrl: null,
    consoleUrl: null,
    tokenEnv: null,
    projectId: null,
    localPath: null,
    findings: [`${source}: project-brain MCP config не найден`],
  };
}

function readTomlProjectBrainServer(content: string): { readonly url: string | null; readonly tokenEnv: string | null } | null {
  let parsed: unknown;
  try {
    parsed = parseToml(content);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const mcpServers = parsed['mcp_servers'];
  if (!isRecord(mcpServers)) return null;
  const server = mcpServers['project-brain'];
  if (!isRecord(server)) return null;
  return {
    url: typeof server.url === 'string' ? server.url : null,
    tokenEnv: typeof server.bearer_token_env_var === 'string' ? server.bearer_token_env_var : null,
  };
}

function normalizeServerUrl(value: string | null): string | null {
  if (!value) return null;
  const normalized = normalizeMcpServerUrl(value);
  return normalized || null;
}

function findArgValue(args: readonly string[], key: string): string | null {
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
