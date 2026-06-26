import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesktopCommandReceipt } from './desktop-command-contracts.js';
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
    if (!isRecord(parsed) || typeof parsed['recordedAt'] !== 'string' || !isRecord(parsed['receipt'])) return [];
    const receipt = parsed['receipt'];
    if (
      receipt['version'] !== 'desktop-command-receipt/v1'
      || typeof receipt['receiptId'] !== 'string'
      || typeof receipt['commandId'] !== 'string'
      || typeof receipt['status'] !== 'string'
    ) {
      return [];
    }
    return [{ recordedAt: parsed['recordedAt'], receipt: receipt as unknown as DesktopCommandReceipt }];
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
