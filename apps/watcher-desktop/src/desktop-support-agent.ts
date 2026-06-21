import { buildDesktopConnectionCheck } from './desktop-connection-check.js';
import { verifyDesktopCodexGates } from './desktop-codex-gates.js';
import { previewDiagnostics } from './desktop-core.js';
import type { DesktopCorePaths } from './desktop-profile-store.js';
import { ensureManagedDeviceEnrolled, readSupportDeviceCredentials, type SupportDeviceCredentials } from './desktop-support-device.js';
import { runServiceAction } from './desktop-service-runner.js';
import { readDesktopUiState } from './desktop-ui-state.js';

const DEFAULT_SUPPORT_JOB_TIMEOUT_MS = 5 * 60_000;
const SUPPORT_JOB_TIMEOUT_ENV = 'PROJECT_BRAIN_SUPPORT_JOB_TIMEOUT_MS';
const DEFAULT_SUPPORT_HTTP_TIMEOUT_MS = 15_000;
const SUPPORT_HTTP_TIMEOUT_ENV = 'PROJECT_BRAIN_SUPPORT_HTTP_TIMEOUT_MS';

type SupportJobAction =
  | 'collect_diagnostics'
  | 'repair_watcher_service'
  | 'restart_watcher'
  | 'update_watcher'
  | 'verify_codex_gates'
  | 'refresh_mcp_config'
  | 'mesh_status';

interface SupportJob {
  readonly jobId: string;
  readonly action: SupportJobAction;
  readonly payload: Record<string, unknown>;
}

export interface SupportAgentRunResult {
  readonly enrolled: boolean;
  readonly status: 'not_enrolled' | 'idle' | 'completed' | 'failed';
  readonly jobId: string | null;
  readonly message: string;
}

export function startDesktopSupportAgent(pathsProvider: () => DesktopCorePaths): () => void {
  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | null = null;
  const intervalMs = supportPollIntervalMs();
  const schedule = () => {
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  const tick = () => {
    if (stopped || running) {
      schedule();
      return;
    }
    running = true;
    runSupportAgentOnceForCurrentProject(pathsProvider())
      .catch(error => console.warn('Support agent tick failed:', error))
      .finally(() => {
        running = false;
        schedule();
      });
  };
  timer = setTimeout(tick, 2500);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export async function runSupportAgentOnce(
  paths: DesktopCorePaths,
  fallbackProjectId?: string,
): Promise<SupportAgentRunResult> {
  let credentials = readSupportDeviceCredentials(paths);
  if (!credentials) {
    const enrollment = await ensureManagedDeviceEnrolled(paths, fallbackProjectId);
    credentials = enrollment.enrolled ? readSupportDeviceCredentials(paths) : null;
  }
  if (!credentials) {
    return { enrolled: false, status: 'not_enrolled', jobId: null, message: 'Support-устройство не зарегистрировано.' };
  }
  await postSupport(credentials.supportBaseUrl, '/api/support/devices/heartbeat', credentials.deviceToken, {
    status: 'online',
    appVersion: process.env.npm_package_version ?? 'desktop',
    supportVersion: '1.0.0',
    meshUrl: credentials.meshUrl ?? '',
  });
  const claim = await postSupport(credentials.supportBaseUrl, '/api/support/jobs/claim', credentials.deviceToken, {});
  const job = toSupportJob(claim['job']);
  if (!job) {
    return { enrolled: true, status: 'idle', jobId: null, message: 'Support jobs нет.' };
  }
  const projectId = projectIdFromPayload(job.payload, fallbackProjectId);
  try {
    await postSupportProgress(credentials, job, 'claimed', 10, 'Пульт получил команду.');
    await postSupportProgress(
      credentials,
      job,
      job.action,
      20,
      supportActionProgressMessage(job.action),
    );
    const result = await withSupportJobTimeout(
      executeSupportJob(paths, job, projectId, credentials.meshUrl),
      supportJobTimeoutMs(job.action),
      job.action,
    );
    await postSupportProgress(credentials, job, 'finalize', 95, 'Отправляем результат команды.');
    await postSupport(
      credentials.supportBaseUrl,
      `/api/support/jobs/${encodeURIComponent(job.jobId)}/complete`,
      credentials.deviceToken,
      { status: 'succeeded', result },
    );
    return { enrolled: true, status: 'completed', jobId: job.jobId, message: `${job.action} выполнен.` };
  } catch (error) {
    const result = { error: error instanceof Error ? error.message : 'Support job failed.' };
    await postSupportProgress(credentials, job, 'failed', 100, result.error);
    await postSupport(
      credentials.supportBaseUrl,
      `/api/support/jobs/${encodeURIComponent(job.jobId)}/complete`,
      credentials.deviceToken,
      { status: 'failed', result },
    );
    return { enrolled: true, status: 'failed', jobId: job.jobId, message: result.error };
  }
}

async function postSupportProgress(
  credentials: SupportDeviceCredentials,
  job: SupportJob,
  stage: string,
  progressPercent: number,
  message: string,
): Promise<void> {
  await postSupport(
    credentials.supportBaseUrl,
    `/api/support/jobs/${encodeURIComponent(job.jobId)}/progress`,
    credentials.deviceToken,
    { stage, progressPercent, message },
  ).catch(error => {
    console.warn('Support job progress failed:', error instanceof Error ? error.message : String(error));
  });
}

async function executeSupportJob(
  paths: DesktopCorePaths,
  job: SupportJob,
  projectId: string,
  meshUrl: string | null,
): Promise<Record<string, unknown>> {
  if (job.action === 'collect_diagnostics') return { diagnostics: previewDiagnostics(paths, projectId) };
  if (job.action === 'repair_watcher_service') {
    return { service: await runServiceAction(paths, { action: 'install', projectId, confirmed: true }) };
  }
  if (job.action === 'restart_watcher') {
    return { service: await runServiceAction(paths, { action: 'restart', projectId, confirmed: true }) };
  }
  if (job.action === 'update_watcher') {
    return { service: await runServiceAction(paths, { action: 'update', projectId, confirmed: true }) };
  }
  if (job.action === 'verify_codex_gates') return { codexGates: await verifyDesktopCodexGates(paths, projectId) };
  if (job.action === 'refresh_mcp_config') return { connection: await buildDesktopConnectionCheck(paths, projectId) };
  if (job.action === 'mesh_status') return { meshUrl, ready: Boolean(meshUrl) };
  throw new Error(`Неизвестное support-действие: ${job.action}`);
}

function withSupportJobTimeout<T>(
  action: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Support job ${label} timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    action.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function supportJobTimeoutMs(action: SupportJobAction): number {
  const configured = Number(process.env[SUPPORT_JOB_TIMEOUT_ENV] ?? '');
  if (Number.isFinite(configured) && configured >= 10) return Math.trunc(configured);
  if (action === 'mesh_status') return 10_000;
  if (action === 'collect_diagnostics') return 30_000;
  if (action === 'refresh_mcp_config') return 90_000;
  if (action === 'verify_codex_gates') return 180_000;
  if (action === 'update_watcher') return 11 * 60_000;
  if (action === 'repair_watcher_service' || action === 'restart_watcher') return 4 * 60_000;
  return DEFAULT_SUPPORT_JOB_TIMEOUT_MS;
}

function supportHttpTimeoutMs(): number {
  const configured = Number(process.env[SUPPORT_HTTP_TIMEOUT_ENV] ?? '');
  if (Number.isFinite(configured) && configured >= 10) return Math.trunc(configured);
  return DEFAULT_SUPPORT_HTTP_TIMEOUT_MS;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function supportActionProgressMessage(action: SupportJobAction): string {
  if (action === 'collect_diagnostics') return 'Собираем диагностику проекта и службы.';
  if (action === 'repair_watcher_service') return 'Проверяем и чиним watcher-службу.';
  if (action === 'restart_watcher') return 'Перезапускаем watcher-службу.';
  if (action === 'update_watcher') return 'Проверяем и устанавливаем обновление watcher.';
  if (action === 'verify_codex_gates') return 'Проверяем Codex gates и evidence.';
  if (action === 'refresh_mcp_config') return 'Проверяем MCP-конфиг и подключение.';
  return 'Проверяем состояние удалённого доступа.';
}

async function postSupport(
  baseUrl: string,
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const timeoutMs = supportHttpTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const parsed: unknown = await response.json().catch(() => null);
    const record = isRecord(parsed) ? parsed : {};
    if (!response.ok || record['ok'] === false) {
      throw new Error(typeof record['error'] === 'string' ? record['error'] : `Support HTTP ${response.status}.`);
    }
    return record;
  } catch (error) {
    if (isAbortError(error)) throw new Error(`Support HTTP ${path} timed out after ${timeoutMs} ms.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function toSupportJob(value: unknown): SupportJob | null {
  if (!isRecord(value) || typeof value['jobId'] !== 'string' || !isSupportJobAction(value['action'])) return null;
  return {
    jobId: value['jobId'],
    action: value['action'],
    payload: isRecord(value['payload']) ? value['payload'] : {},
  };
}

function isSupportJobAction(value: unknown): value is SupportJobAction {
  return (
    value === 'collect_diagnostics' ||
    value === 'repair_watcher_service' ||
    value === 'restart_watcher' ||
    value === 'update_watcher' ||
    value === 'verify_codex_gates' ||
    value === 'refresh_mcp_config' ||
    value === 'mesh_status'
  );
}

function projectIdFromPayload(payload: Record<string, unknown>, fallback: string | undefined): string {
  const projectId = payload['projectId'] ?? payload['project_id'];
  return typeof projectId === 'string' && projectId.trim() ? projectId.trim() : fallback ?? 'default';
}

function supportPollIntervalMs(): number {
  const parsed = Number(process.env.PROJECT_BRAIN_SUPPORT_AGENT_INTERVAL_MS ?? '');
  return Number.isFinite(parsed) && parsed >= 5000 ? parsed : 30000;
}

function runSupportAgentOnceForCurrentProject(paths: DesktopCorePaths): Promise<SupportAgentRunResult> {
  return runSupportAgentOnce(paths, readDesktopUiState(paths).lastProjectId ?? undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
