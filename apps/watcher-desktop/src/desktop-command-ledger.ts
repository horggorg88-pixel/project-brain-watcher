import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DesktopCommandAckState,
  DesktopCommandCategory,
  DesktopCommandDiagnostic,
  DesktopCommandId,
  DesktopCommandProgressStep,
  DesktopCommandProgressStepStatus,
  DesktopCommandReceipt,
  DesktopCommandRisk,
  DesktopCommandStatus,
  DesktopCommandSurface,
} from './desktop-command-contracts.js';
import { allDesktopCommandDescriptors } from './desktop-command-registry.js';
import type { DesktopCorePaths } from './desktop-profile-store.js';

export interface DesktopCommandLedgerEntry {
  readonly recordedAt: string;
  readonly receipt: DesktopCommandReceipt;
}

export interface DesktopCommandLedgerWrite {
  readonly saved: boolean;
  readonly path: string;
  readonly error: string | null;
}

const COMMAND_LEDGER_FILE = 'desktop-command-receipts.ndjson';
const RECEIPT_VALUES = {
  commandIds: allDesktopCommandDescriptors().map(descriptor => descriptor.id) as readonly DesktopCommandId[],
  surfaces: ['electron', 'mcp', 'cli', 'remote'] as const satisfies readonly DesktopCommandSurface[],
  categories: [
    'watcher_service',
    'codex_gates',
    'mcp_config',
    'remote_support',
    'updater',
    'diagnostics',
  ] as const satisfies readonly DesktopCommandCategory[],
  statuses: [
    'queued',
    'running',
    'passed',
    'failed',
    'blocked',
    'waiting',
    'stale',
    'unavailable',
    'timed_out',
    'cancelled',
  ] as const satisfies readonly DesktopCommandStatus[],
  risks: ['low', 'medium', 'high'] as const satisfies readonly DesktopCommandRisk[],
  ackStates: [
    'local_committed',
    'server_pending',
    'server_acknowledged',
    'server_failed',
  ] as const satisfies readonly DesktopCommandAckState[],
  stepStatuses: [
    'pending',
    'running',
    'passed',
    'failed',
    'skipped',
  ] as const satisfies readonly DesktopCommandProgressStepStatus[],
  diagnosticSeverities: ['info', 'warning', 'error'] as const,
};

export function appendDesktopCommandReceipt(
  paths: DesktopCorePaths,
  receipt: DesktopCommandReceipt,
  recordedAt = new Date().toISOString(),
): DesktopCommandLedgerWrite {
  const path = desktopCommandLedgerPath(paths);
  try {
    mkdirSync(paths.userDataPath, { recursive: true });
    appendFileSync(path, `${JSON.stringify({ recordedAt, receipt })}\n`, 'utf-8');
    return { saved: true, path, error: null };
  } catch (error) {
    return { saved: false, path, error: error instanceof Error ? error.message : String(error) };
  }
}

export function readDesktopCommandReceipts(
  paths: DesktopCorePaths,
  limit = 50,
): readonly DesktopCommandLedgerEntry[] {
  const path = desktopCommandLedgerPath(paths);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf-8')
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0)
    .slice(-Math.max(1, limit));
  return lines.flatMap(toLedgerEntry);
}

export function desktopCommandLedgerPath(paths: DesktopCorePaths): string {
  return join(paths.userDataPath, COMMAND_LEDGER_FILE);
}

function toLedgerEntry(line: string): readonly DesktopCommandLedgerEntry[] {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) return [];
    const recordedAt = parsed['recordedAt'];
    const receipt = parsed['receipt'];
    if (typeof recordedAt !== 'string' || !isDesktopCommandReceipt(receipt)) return [];
    return [{ recordedAt, receipt }];
  } catch {
    return [];
  }
}

function isDesktopCommandReceipt(value: unknown): value is DesktopCommandReceipt {
  if (!isRecord(value)) return false;
  const elapsedMs = value['elapsedMs'];
  const logCursor = value['logCursor'];
  return (
    value['version'] === 'desktop-command-receipt/v1'
    && typeof value['receiptId'] === 'string'
    && typeof value['runId'] === 'string'
    && isOneOf(value['commandId'], RECEIPT_VALUES.commandIds)
    && typeof value['projectId'] === 'string'
    && isOneOf(value['surface'], RECEIPT_VALUES.surfaces)
    && isOneOf(value['category'], RECEIPT_VALUES.categories)
    && isOneOf(value['status'], RECEIPT_VALUES.statuses)
    && isOneOf(value['risk'], RECEIPT_VALUES.risks)
    && typeof value['startedAt'] === 'string'
    && typeof value['updatedAt'] === 'string'
    && (elapsedMs === null || (typeof elapsedMs === 'number' && Number.isFinite(elapsedMs)))
    && isOneOf(value['ackState'], RECEIPT_VALUES.ackStates)
    && (logCursor === null || typeof logCursor === 'string')
    && isNullableDiagnostic(value['diagnostic'])
    && Array.isArray(value['steps'])
    && value['steps'].every(isProgressStep)
  );
}

function isNullableDiagnostic(value: unknown): value is DesktopCommandDiagnostic | null {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const evidenceRefs = value['evidenceRefs'];
  return (
    typeof value['code'] === 'string'
    && isOneOf(value['severity'], RECEIPT_VALUES.diagnosticSeverities)
    && typeof value['title'] === 'string'
    && typeof value['detail'] === 'string'
    && typeof value['nextAction'] === 'string'
    && Array.isArray(evidenceRefs)
    && evidenceRefs.every(item => typeof item === 'string')
  );
}

function isProgressStep(value: unknown): value is DesktopCommandProgressStep {
  if (!isRecord(value)) return false;
  return (
    typeof value['id'] === 'string'
    && typeof value['label'] === 'string'
    && isOneOf(value['status'], RECEIPT_VALUES.stepStatuses)
    && typeof value['detail'] === 'string'
  );
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.some(option => option === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
