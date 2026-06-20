import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { join } from 'node:path';
import type {
  SavedProjectProfile,
  WatcherServiceLogChunk,
  WatcherServiceLogStream,
  WatcherServiceLogTail,
  WatcherServiceStatus,
} from './contracts.js';
import {
  defaultProfile,
  readProfiles,
  serviceExePath,
  serviceName,
  type DesktopCorePaths,
} from './desktop-profile-store.js';

const WATCHER_LOCK_TTL_MS = 90_000;
const SERVICE_LOG_TAIL_BYTES = 16_384;
const SERVICE_LOG_TAIL_LINES = 80;
const SERVICE_LOG_CHUNK_BYTES = 24_000;
const SERVICE_LOG_IDENTITY_BYTES = 4096;

type ServiceLogStreamId = 'out' | 'err' | 'wrapper';

interface RuntimeLockFile {
  readonly owner: {
    readonly project_id: string;
    readonly root: string;
    readonly pid: number;
  };
  readonly updated_at: number;
}

interface ServiceLogCursor {
  readonly version: 1;
  readonly streamId: ServiceLogStreamId;
  readonly offset: number;
  readonly sizeBytes: number;
  readonly modifiedAtMs: number;
  readonly headHash: string;
}

export interface WindowsServiceState {
  readonly installed: boolean;
  readonly running: boolean;
  readonly lastError: string | null;
  readonly serviceBinaryPath: string | null;
  readonly metadataError: string | null;
}

export interface WindowsServiceConfigState {
  readonly binaryPath: string | null;
}

export function readServiceStatus(paths: DesktopCorePaths, projectId?: string): WatcherServiceStatus {
  const profile = resolveServiceProfile(paths, projectId);
  if (!profile) return stoppedStatus(false, 'Проект watcher не настроен');
  const runtimePath = join(profile.root, '.brain', 'watcher-runtime.json');
  const logs = readServiceLogTail(profile);
  const serviceState = readWindowsServiceState(profile);
  const serviceFilesPrepared = existsSync(serviceExePath(profile));
  const installed = serviceState.installed;
  if (serviceState.installed && serviceState.metadataError) {
    return stoppedStatus(true, joinStatusMessages(serviceState.lastError, serviceState.metadataError), profile, logs);
  }
  if (serviceState.installed && !serviceState.running) {
    return stoppedStatus(true, serviceState.lastError ?? 'Служба Watcher остановлена', profile, logs);
  }
  if (!serviceState.installed && serviceFilesPrepared && !existsSync(runtimePath)) {
    return stoppedStatus(false, 'Windows service не зарегистрирована; файлы службы подготовлены, но install не завершился', profile, logs);
  }
  if (!existsSync(runtimePath)) return stoppedStatus(installed, 'Служба Watcher не запущена', profile, logs);
  try {
    const parsed = parseRuntimeLock(JSON.parse(readFileSync(runtimePath, 'utf-8')));
    if (!parsed) return { ...stoppedStatus(installed, 'Файл состояния службы повреждён', profile, logs), readOnly: true, health: 'read_only' };
    const stale = Date.now() - parsed.updated_at > WATCHER_LOCK_TTL_MS || (!serviceState.running && !processAlive(parsed.owner.pid));
    return {
      installed,
      running: !stale,
      readOnly: stale,
      health: stale ? 'degraded' : 'healthy',
      projectId: parsed.owner.project_id,
      root: parsed.owner.root,
      pid: parsed.owner.pid,
      queueDepth: 0,
      lastSyncAt: new Date(parsed.updated_at).toISOString(),
      lastError: stale ? 'Файл состояния службы устарел или процесс недоступен' : null,
      logs,
    };
  } catch (error) {
    return { ...stoppedStatus(installed, errorMessage(error), profile, logs), readOnly: true, health: 'read_only' };
  }
}

export function resolveServiceProfile(paths: DesktopCorePaths, projectId?: string): SavedProjectProfile | null {
  const profiles = readProfiles(paths);
  if (!projectId) return profiles[0] ?? defaultProfile(paths);
  const profile = profiles.find(item => item.id === projectId);
  if (profile) return profile;
  const fallback = defaultProfile(paths);
  return fallback?.id === projectId ? fallback : null;
}

function stoppedStatus(
  installed: boolean,
  lastError: string,
  profile?: SavedProjectProfile,
  logs: WatcherServiceLogTail | null = profile ? readServiceLogTail(profile) : null,
): WatcherServiceStatus {
  return {
    installed,
    running: false,
    readOnly: true,
    health: installed ? 'stopped' : 'not_configured',
    projectId: profile?.id ?? null,
    root: profile?.root ?? null,
    pid: null,
    queueDepth: 0,
    lastSyncAt: null,
    lastError,
    logs,
  };
}

export function readServiceLogTail(profile: SavedProjectProfile): WatcherServiceLogTail {
  const base = join(profile.root, '.brain', 'service', serviceName(profile.id));
  const wrapperPath = `${base}.wrapper.log`;
  const outPath = `${base}.out.log`;
  const errPath = `${base}.err.log`;
  return {
    wrapperPath,
    outPath,
    errPath,
    wrapper: readTail(wrapperPath),
    out: readTail(outPath),
    err: readTail(errPath),
    transport: {
      version: 'watcher-log-transport/v1',
      chunkSizeBytes: SERVICE_LOG_CHUNK_BYTES,
      streams: [
        logStream('out', 'Лог работы watcher', outPath),
        logStream('err', 'Ошибки watcher', errPath),
        logStream('wrapper', 'Лог Windows-службы', wrapperPath),
      ],
    },
  };
}

export function readServiceLogChunk(
  profile: SavedProjectProfile,
  cursorId: string,
): WatcherServiceLogChunk | null {
  const cursor = decodeServiceLogCursor(cursorId);
  if (!cursor) return null;
  const path = serviceLogPath(profile, cursor.streamId);
  if (!path || !existsSync(path)) return null;
  try {
    const stat = statSync(path);
    if (cursor.offset > stat.size || stat.size < cursor.sizeBytes) return null;
    if (cursor.headHash !== serviceLogHeadHash(path, stat)) return null;
    const end = Math.min(stat.size, cursor.offset + SERVICE_LOG_CHUNK_BYTES);
    const body = readBytes(path, cursor.offset, end - cursor.offset);
    return {
      version: 'watcher-log-transport/v1',
      streamId: cursor.streamId,
      cursorId,
      offset: cursor.offset,
      bytes: body.byteLength,
      text: redactServiceLogText(stripAnsi(body.toString('utf8'))),
      nextCursor: end < stat.size ? encodeServiceLogCursor(cursor.streamId, end, path, stat) : null,
      complete: end >= stat.size,
    };
  } catch {
    return null;
  }
}

function readWindowsServiceState(profile: SavedProjectProfile): WindowsServiceState {
  if (process.platform !== 'win32') return emptyWindowsServiceState();
  const result = spawnSync('sc.exe', ['queryex', serviceName(profile.id)], { encoding: 'utf-8', windowsHide: true });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  if (result.status !== 0) return emptyWindowsServiceState();
  const state = parseWindowsServiceOutput(output);
  const config = readWindowsServiceConfigState(profile);
  return {
    ...state,
    serviceBinaryPath: config.binaryPath,
    metadataError: windowsServiceMetadataError(profile, config),
  };
}

export function parseWindowsServiceOutput(output: string): WindowsServiceState {
  return {
    installed: true,
    running: parseWindowsServiceState(output)?.code === '4',
    lastError: parseWindowsServiceExit(output),
    serviceBinaryPath: null,
    metadataError: null,
  };
}

export function parseWindowsServiceConfigOutput(output: string): WindowsServiceConfigState {
  const match = output.match(/BINARY_PATH_NAME\s*:\s*(.+)/i);
  return { binaryPath: match ? extractExecutablePath(match[1]) : extractExecutablePath(output) };
}

function parseWindowsServiceExit(output: string): string | null {
  const state = parseWindowsServiceState(output);
  const stateName = state?.name ?? 'UNKNOWN';
  const win32Exit = output.match(/:\s*(\d+)\s+\(0x[0-9a-f]+\)/i)?.[1] ?? null;
  if (state?.code === '4') return null;
  return win32Exit && win32Exit !== '0'
    ? `Windows Service ${stateName}, WIN32_EXIT_CODE=${win32Exit}`
    : `Windows Service ${stateName}`;
}

function parseWindowsServiceState(output: string): { readonly code: string; readonly name: string } | null {
  const match = output.match(/:\s*([1-7])\s+(STOPPED|START_PENDING|STOP_PENDING|RUNNING|CONTINUE_PENDING|PAUSE_PENDING|PAUSED)\b/i);
  return match ? { code: match[1], name: match[2].toUpperCase() } : null;
}

function readWindowsServiceConfigState(profile: SavedProjectProfile): WindowsServiceConfigState {
  const result = spawnSync('sc.exe', ['qc', serviceName(profile.id)], { encoding: 'utf-8', windowsHide: true });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  return result.status === 0 ? parseWindowsServiceConfigOutput(output) : { binaryPath: null };
}

function windowsServiceMetadataError(profile: SavedProjectProfile, config: WindowsServiceConfigState): string | null {
  if (!config.binaryPath) return null;
  const expectedExe = serviceExePath(profile);
  if (normalizePath(config.binaryPath) === normalizePath(expectedExe)) return null;
  const actualRoot = serviceRootFromBinaryPath(config.binaryPath) ?? config.binaryPath;
  return `Windows Service metadata указывает на другой root: ${actualRoot}. Ожидался ${profile.root}.`;
}

function serviceRootFromBinaryPath(path: string): string | null {
  const normalized = normalizePath(path);
  const marker = '/.brain/service/';
  const markerIndex = normalized.indexOf(marker);
  return markerIndex === -1 ? null : path.slice(0, markerIndex);
}

function extractExecutablePath(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    const endQuote = trimmed.indexOf('"', 1);
    if (endQuote > 0) return trimmed.slice(1, endQuote);
  }
  const executable = trimmed.match(/[A-Za-z]:\\[^\r\n"]*?\.exe\b/i)?.[0];
  return executable ?? null;
}

function emptyWindowsServiceState(): WindowsServiceState {
  return {
    installed: false,
    running: false,
    lastError: null,
    serviceBinaryPath: null,
    metadataError: null,
  };
}

function joinStatusMessages(...messages: Array<string | null>): string {
  return messages.filter((message): message is string => Boolean(message)).join('\n');
}

function parseRuntimeLock(value: unknown): RuntimeLockFile | null {
  if (!isRecord(value) || !isRecord(value.owner)) return null;
  const owner = value.owner;
  return typeof owner.project_id === 'string'
    && typeof owner.root === 'string'
    && typeof owner.pid === 'number'
    && typeof value.updated_at === 'number'
    ? { owner: { project_id: owner.project_id, root: owner.root, pid: owner.pid }, updated_at: value.updated_at }
    : null;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readTail(path: string): string {
  if (!existsSync(path)) return '';
  try {
    const size = statSync(path).size;
    const offset = Math.max(0, size - SERVICE_LOG_TAIL_BYTES);
    const tail = readBytes(path, offset, size - offset).toString('utf8');
    return lastLines(redactServiceLogText(stripAnsi(tail)), SERVICE_LOG_TAIL_LINES);
  } catch (error) {
    return `Лог недоступен: ${errorMessage(error)}`;
  }
}

function logStream(id: ServiceLogStreamId, label: string, path: string): WatcherServiceLogStream {
  if (!existsSync(path)) {
    return {
      id,
      label,
      path,
      exists: false,
      sizeBytes: 0,
      modifiedAt: null,
      tail: { offset: 0, bytes: 0, truncated: false },
      firstCursor: null,
    };
  }
  const stat = statSync(path);
  const tailBytes = Math.min(stat.size, SERVICE_LOG_TAIL_BYTES);
  return {
    id,
    label,
    path,
    exists: true,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    tail: {
      offset: Math.max(0, stat.size - tailBytes),
      bytes: tailBytes,
      truncated: stat.size > SERVICE_LOG_TAIL_BYTES,
    },
    firstCursor: stat.size > 0 ? encodeServiceLogCursor(id, 0, path, stat) : null,
  };
}

function serviceLogPath(profile: SavedProjectProfile, streamId: ServiceLogStreamId): string | null {
  const base = join(profile.root, '.brain', 'service', serviceName(profile.id));
  if (streamId === 'out') return `${base}.out.log`;
  if (streamId === 'err') return `${base}.err.log`;
  if (streamId === 'wrapper') return `${base}.wrapper.log`;
  return null;
}

function encodeServiceLogCursor(streamId: ServiceLogStreamId, offset: number, path: string, stat: Stats): string {
  const cursor: ServiceLogCursor = {
    version: 1,
    streamId,
    offset,
    sizeBytes: stat.size,
    modifiedAtMs: Math.trunc(stat.mtimeMs),
    headHash: serviceLogHeadHash(path, stat),
  };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeServiceLogCursor(cursorId: string): ServiceLogCursor | null {
  try {
    const decoded = Buffer.from(cursorId, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as unknown;
    return isServiceLogCursor(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isServiceLogCursor(value: unknown): value is ServiceLogCursor {
  if (!isRecord(value)) return false;
  return value.version === 1
    && isServiceLogStreamId(value.streamId)
    && isNonNegativeSafeInteger(value.offset)
    && isNonNegativeSafeInteger(value.sizeBytes)
    && isNonNegativeSafeInteger(value.modifiedAtMs)
    && typeof value.headHash === 'string'
    && /^[a-f0-9]{64}$/.test(value.headHash);
}

function isServiceLogStreamId(value: unknown): value is ServiceLogStreamId {
  return value === 'out' || value === 'err' || value === 'wrapper';
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function readBytes(path: string, offset: number, byteLength: number): Buffer {
  if (byteLength <= 0) return Buffer.alloc(0);
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(byteLength);
    const bytesRead = readSync(fd, buffer, 0, byteLength, offset);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

function stripAnsi(value: string): string {
  return value
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001B[@-Z\\-_]/g, '')
    .replace(/\r/g, '');
}

function redactServiceLogText(value: string): string {
  return value
    .replace(/Authorization:\s*Bearer\s+[^\s"'}]+/gi, 'Authorization: Bearer [REDACTED]')
    .replace(/Bearer\s+pb_[A-Za-z0-9._-]+/g, 'Bearer pb_[REDACTED]')
    .replace(/\b(MCP_BEARER_TOKEN|TOKEN|API_KEY|PASSWORD|SECRET)\s*[=:]\s*[^\s,"'}]+/gi, '$1=[REDACTED]')
    .replace(/pb_[A-Za-z0-9._-]{8,}/g, 'pb_[REDACTED]');
}

function serviceLogHeadHash(path: string, stat: Stats): string {
  const bytes = Math.min(stat.size, SERVICE_LOG_IDENTITY_BYTES);
  return createHash('sha256').update(readBytes(path, 0, bytes)).digest('hex');
}

function lastLines(value: string, limit: number): string {
  const lines = value.split('\n').map(line => line.trimEnd()).filter(line => line.trim().length > 0);
  return lines.slice(-limit).join('\n');
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
