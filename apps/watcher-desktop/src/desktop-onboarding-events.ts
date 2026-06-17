import type { DesktopCheckNode, DesktopConnectionCheck, DesktopMcpIndexSnapshot, SavedProjectProfile } from './contracts.js';
import { discoverMcpConfig } from './desktop-config-discovery.js';
import { normalizeMcpServerUrl } from './desktop-mcp-endpoint.js';
import { applyMcpConfigToProfile, type DesktopCorePaths } from './desktop-profile-store.js';
import { readDesktopServiceToken } from './desktop-service-secret.js';
import { resolveServiceProfile } from './desktop-service-status.js';

export type DesktopOnboardingEventType =
  | 'desktop_opened'
  | 'project_selected'
  | 'config_ready'
  | 'codex_gates_verified'
  | 'watcher_started';

export type DesktopOnboardingEventSource = 'desktop' | 'watcher';

export interface DesktopOnboardingEventReport {
  readonly eventType: DesktopOnboardingEventType;
  readonly source: DesktopOnboardingEventSource;
  readonly projectId?: string;
  readonly payload: Record<string, unknown>;
}

export interface ReportOnboardingEventsInput {
  readonly profile: SavedProjectProfile;
  readonly token: string | null;
  readonly events: readonly DesktopOnboardingEventReport[];
  readonly fetcher?: typeof fetch;
}

export interface OnboardingEventReportResult {
  readonly eventType: DesktopOnboardingEventType;
  readonly sent: boolean;
  readonly endpoint: string;
  readonly status: number | null;
  readonly error: string | null;
}

const ONBOARDING_EVENTS_PATH = '/api/onboarding/events';
const DEFAULT_MCP_SERVER_URL = 'http://149.33.14.250';
const DEFAULT_CONSOLE_URL = 'http://149.33.14.250:3020';

export function buildOnboardingEventReports(check: DesktopConnectionCheck): readonly DesktopOnboardingEventReport[] {
  const projectId = check.projectId ?? check.service.projectId ?? undefined;
  const events: DesktopOnboardingEventReport[] = [
    event('desktop_opened', 'desktop', projectId, {
      checkedAt: check.checkedAt,
      overall: check.overall,
    }),
  ];
  if (nodeActive(check.nodes, 'project')) {
    events.push(event('project_selected', 'desktop', projectId, {
      checkedAt: check.checkedAt,
      root: check.service.root,
    }));
  }
  if (nodeActive(check.nodes, 'config') && nodeActive(check.nodes, 'key')) {
    events.push(event('config_ready', 'desktop', projectId, {
      checkedAt: check.checkedAt,
      serverVerified: nodeActive(check.nodes, 'server'),
    }));
  }
  if (check.codexGates?.ready) {
    events.push(event('codex_gates_verified', 'desktop', projectId, {
      commandRuns: check.codexGates.evidence.commandRuns,
      verification: {
        ...check.codexGates.evidence.verification,
        serverAuth: serverAuthEvidence(check),
      },
      ...(check.mcpIndex ? { mcpIndex: mcpIndexEvidence(check.mcpIndex, check) } : {}),
    }));
  }
  if (check.service.running && check.service.health === 'healthy') {
    events.push(event('watcher_started', 'watcher', projectId, {
      checkedAt: check.checkedAt,
      health: check.service.health,
      pid: check.service.pid,
      lastSyncAt: check.service.lastSyncAt,
    }));
  }
  return events;
}

export async function reportDesktopOnboardingProgress(
  paths: DesktopCorePaths,
  projectId: string,
  check: DesktopConnectionCheck,
): Promise<readonly OnboardingEventReportResult[]> {
  const events = buildOnboardingEventReports(check);
  if (events.length === 0) return [];
  const profile = resolveOnboardingProfile(paths, check.projectId ?? projectId);
  if (!profile) return events.map(item => skipped(item, '', 'project_profile_missing'));
  const results = await reportOnboardingEvents({
    profile,
    token: readDesktopServiceToken(profile),
    events,
  });
  results
    .filter(result => !result.sent)
    .forEach(result => {
      console.warn(`Onboarding event '${result.eventType}' was not reported: ${result.error ?? 'unknown error'}`);
    });
  return results;
}

export async function reportOnboardingEvents(
  input: ReportOnboardingEventsInput,
): Promise<readonly OnboardingEventReportResult[]> {
  const endpoint = onboardingEventsEndpoint(input.profile);
  if (!endpoint) return input.events.map(item => skipped(item, '', 'server_url_missing'));
  if (!input.token) return input.events.map(item => skipped(item, endpoint, 'bearer_missing'));
  const fetcher = input.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== 'function') return input.events.map(item => skipped(item, endpoint, 'fetch_unavailable'));

  const results: OnboardingEventReportResult[] = [];
  for (const item of input.events) {
    results.push(await postOnboardingEvent(fetcher, endpoint, input.token, item));
  }
  return results;
}

function event(
  eventType: DesktopOnboardingEventType,
  source: DesktopOnboardingEventSource,
  projectId: string | undefined,
  payload: Record<string, unknown>,
): DesktopOnboardingEventReport {
  return projectId ? { eventType, source, projectId, payload } : { eventType, source, payload };
}

function nodeActive(nodes: readonly DesktopCheckNode[], id: string): boolean {
  return nodes.some(node => node.id === id && node.status === 'active');
}

function serverAuthEvidence(check: DesktopConnectionCheck): Record<string, unknown> {
  const server = check.nodes.find(node => node.id === 'server');
  const passed = server?.status === 'active';
  return {
    available: true,
    passed,
    detail: server?.detail ?? 'MCP-сервер не проверен.',
    checkedAt: check.checkedAt,
    staleAfterMs: 10 * 60 * 1000,
    source: 'desktop-connection-check',
  };
}

function mcpIndexEvidence(index: DesktopMcpIndexSnapshot, check: DesktopConnectionCheck): Record<string, unknown> {
  return {
    ...index,
    watcherActive: check.service.running && check.service.health === 'healthy',
    watcherHeartbeatAt: check.service.lastSyncAt ?? check.checkedAt,
    source: index.source,
  };
}

function resolveOnboardingProfile(paths: DesktopCorePaths, projectId: string): SavedProjectProfile | null {
  return applyMcpConfigToProfile(resolveServiceProfile(paths, projectId), discoverMcpConfig(paths));
}

function onboardingEventsEndpoint(profile: SavedProjectProfile): string {
  const base = resolveOnboardingConsoleUrl(profile);
  return base ? `${base}${ONBOARDING_EVENTS_PATH}` : '';
}

function resolveOnboardingConsoleUrl(profile: SavedProjectProfile): string {
  const configured = normalizeMcpServerUrl(profile.consoleUrl ?? '')
    || normalizeMcpServerUrl(process.env.MCP_ONBOARDING_SERVER_URL ?? '');
  if (configured) return configured;
  const serverUrl = normalizeMcpServerUrl(profile.serverUrl);
  return serverUrl === DEFAULT_MCP_SERVER_URL ? DEFAULT_CONSOLE_URL : serverUrl;
}

async function postOnboardingEvent(
  fetcher: typeof fetch,
  endpoint: string,
  token: string,
  item: DesktopOnboardingEventReport,
): Promise<OnboardingEventReportResult> {
  try {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(item),
    });
    return {
      eventType: item.eventType,
      sent: response.ok,
      endpoint,
      status: response.status,
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      eventType: item.eventType,
      sent: false,
      endpoint,
      status: null,
      error: errorMessage(error),
    };
  }
}

function skipped(
  item: DesktopOnboardingEventReport,
  endpoint: string,
  error: string,
): OnboardingEventReportResult {
  return {
    eventType: item.eventType,
    sent: false,
    endpoint,
    status: null,
    error,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
