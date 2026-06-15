import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SavedProjectProfile } from './contracts.js';
import { buildProjectMcpEndpoint } from './desktop-mcp-endpoint.js';
import { isConcreteBearerToken, stageDesktopServiceSecret } from './desktop-service-secret.js';

const BRAIN_DIR = '.brain';
const BRAIN_CONFIG_FILE = 'config.json';
const BRAIN_MCP_FILE = 'mcp.json';
const DEFAULT_EXTENSIONS = '.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.cs,.go,.rs,.java,.kt,.swift,.rb,.php,.c,.cpp,.h,.hpp,.cc,.vue,.svelte,.html,.htm,.css,.scss,.sass,.less,.json,.properties,.yaml,.yml,.xml,.sql,.sh,.md,.graphql,.gql,.dart,.scala,.lua,.r,.ex,.exs,.proto';
const DEFAULT_IGNORE = 'node_modules,dist,.git,.brain,build,out,coverage,__pycache__,.venv,venv,env,.next,.nuxt,vendor,target,.cache,obj,.idea,.vscode,.DS_Store,package-lock.json,yarn.lock,pnpm-lock.yaml';

export interface DesktopBrainBootstrapResult {
  readonly staged: boolean;
  readonly endpoint: string;
  readonly brainDir: string;
  readonly configPath: string;
  readonly mcpPath: string;
  readonly reason: string | null;
}

export interface DesktopBrainFilePaths {
  readonly brainDir: string;
  readonly configPath: string;
  readonly mcpPath: string;
}

export function stageProjectBrainFiles(
  profile: SavedProjectProfile,
  options: { readonly bearerToken?: string | null } = {},
): DesktopBrainBootstrapResult {
  const endpoint = buildProjectMcpEndpoint(profile.serverUrl, profile.id);
  const { brainDir, configPath, mcpPath } = projectBrainFilePaths(profile);
  if (!endpoint) return skipped(endpoint, brainDir, configPath, mcpPath, 'mcp_server_missing');
  if (!existsSync(profile.root)) return skipped(endpoint, brainDir, configPath, mcpPath, 'project_root_missing');

  const token = isConcreteBearerToken(options.bearerToken) ? options.bearerToken.trim() : null;
  if (!token) return skipped(endpoint, brainDir, configPath, mcpPath, 'bearer_missing');

  mkdirSync(brainDir, { recursive: true });
  writeGitignore(brainDir);
  writeFileSync(configPath, `${JSON.stringify(buildBrainConfig(configPath, profile, endpoint), null, 2)}\n`, 'utf-8');
  writeFileSync(mcpPath, `${JSON.stringify(buildProjectMcpConfig(profile, endpoint, token), null, 2)}\n`, 'utf-8');
  stageDesktopServiceSecret(profile, token);
  return { staged: true, endpoint, brainDir, configPath, mcpPath, reason: null };
}

export function projectBrainFilePaths(profile: SavedProjectProfile): DesktopBrainFilePaths {
  const brainDir = join(profile.root, BRAIN_DIR);
  return {
    brainDir,
    configPath: join(brainDir, BRAIN_CONFIG_FILE),
    mcpPath: join(brainDir, BRAIN_MCP_FILE),
  };
}

function skipped(
  endpoint: string,
  brainDir: string,
  configPath: string,
  mcpPath: string,
  reason: string,
): DesktopBrainBootstrapResult {
  return { staged: false, endpoint, brainDir, configPath, mcpPath, reason };
}

function buildBrainConfig(
  configPath: string,
  profile: SavedProjectProfile,
  endpoint: string,
): Record<string, unknown> {
  const existing = readJsonRecord(configPath);
  return {
    ...existing,
    project_id: profile.id,
    server: profile.serverUrl,
    ...(profile.consoleUrl ? { console_url: profile.consoleUrl } : {}),
    token_env: profile.tokenEnv,
    mcp_endpoint: endpoint,
    mcp_config_path: `${BRAIN_DIR}/${BRAIN_MCP_FILE}`,
    extensions: stringValue(existing.extensions) ?? DEFAULT_EXTENSIONS,
    ignore: stringValue(existing.ignore) ?? DEFAULT_IGNORE,
    batch_size: numberValue(existing.batch_size) ?? 10,
    interval_min: numberValue(existing.interval_min) ?? 3,
    delta_startup: booleanValue(existing.delta_startup) ?? true,
    delta_fallback: stringValue(existing.delta_fallback) ?? 'full',
    manifest_timeout_ms: numberValue(existing.manifest_timeout_ms) ?? 30_000,
    manifest_retries: numberValue(existing.manifest_retries) ?? 2,
    event_debounce_ms: numberValue(existing.event_debounce_ms) ?? 3_000,
  };
}

function buildProjectMcpConfig(
  profile: SavedProjectProfile,
  endpoint: string,
  bearerToken: string | null | undefined,
): Record<string, unknown> {
  const token = isConcreteBearerToken(bearerToken) ? bearerToken.trim() : null;
  return {
    project_id: profile.id,
    endpoint,
    ...(profile.consoleUrl ? { console_url: profile.consoleUrl } : {}),
    mcpServers: {
      'project-brain': {
        url: endpoint,
        headers: {
          Authorization: token ? `Bearer ${token}` : `Bearer \${${profile.tokenEnv}}`,
        },
      },
    },
  };
}

function writeGitignore(brainDir: string): void {
  const gitignorePath = join(brainDir, '.gitignore');
  if (!existsSync(gitignorePath)) writeFileSync(gitignorePath, '*\n', 'utf-8');
}

function readJsonRecord(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
