import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DesktopCommandReceipt } from '../../apps/watcher-desktop/src/contracts.js';
import {
  appendDesktopCommandReceipt,
  desktopCommandLedgerPath,
  readDesktopCommandReceipts,
} from '../../apps/watcher-desktop/src/desktop-command-ledger.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('watcher desktop command ledger', () => {
  it('stores command receipts as local NDJSON evidence', () => {
    const paths = tempPaths();
    const receipt = receiptFixture();

    const write = appendDesktopCommandReceipt(paths, receipt, '2026-06-26T10:02:00.000Z');
    const entries = readDesktopCommandReceipts(paths);

    expect(write.saved).toBe(true);
    expect(write.path).toBe(desktopCommandLedgerPath(paths));
    expect(entries).toHaveLength(1);
    expect(entries[0].recordedAt).toBe('2026-06-26T10:02:00.000Z');
    expect(entries[0].receipt.receiptId).toBe(receipt.receiptId);
  });

  it('keeps the latest receipts when the ledger is tailed', () => {
    const paths = tempPaths();

    appendDesktopCommandReceipt(paths, { ...receiptFixture(), receiptId: 'dcr_old' }, '2026-06-26T10:00:00.000Z');
    appendDesktopCommandReceipt(paths, { ...receiptFixture(), receiptId: 'dcr_new' }, '2026-06-26T10:01:00.000Z');

    expect(readDesktopCommandReceipts(paths, 1).map(entry => entry.receipt.receiptId)).toEqual(['dcr_new']);
  });

  it('skips malformed lines and partial receipt entries', () => {
    const paths = tempPaths();
    mkdirSync(paths.userDataPath, { recursive: true });
    const validReceipt = { ...receiptFixture(), receiptId: 'dcr_valid' };
    const partialReceipt = {
      version: 'desktop-command-receipt/v1',
      receiptId: 'dcr_partial',
      commandId: 'watcher.start',
      status: 'passed',
    };

    writeFileSync(
      desktopCommandLedgerPath(paths),
      [
        '{not json',
        JSON.stringify({ recordedAt: '2026-06-26T10:01:00.000Z', receipt: partialReceipt }),
        JSON.stringify({ recordedAt: '2026-06-26T10:02:00.000Z', receipt: validReceipt }),
      ].join('\n'),
      'utf-8',
    );

    const entries = readDesktopCommandReceipts(paths);

    expect(entries).toHaveLength(1);
    expect(entries[0].recordedAt).toBe('2026-06-26T10:02:00.000Z');
    expect(entries[0].receipt.receiptId).toBe('dcr_valid');
  });
});

function tempPaths() {
  const root = mkdtempSync(join(tmpdir(), 'watcher-command-ledger-'));
  tempDirs.push(root);
  return {
    homePath: join(root, 'home'),
    userDataPath: join(root, 'user-data'),
  };
}

function receiptFixture(): DesktopCommandReceipt {
  return {
    version: 'desktop-command-receipt/v1',
    receiptId: 'dcr_fixture',
    runId: 'dcrun_fixture',
    commandId: 'watcher.start',
    projectId: 'demo',
    surface: 'electron',
    category: 'watcher_service',
    status: 'passed',
    risk: 'medium',
    startedAt: '2026-06-26T10:00:00.000Z',
    updatedAt: '2026-06-26T10:01:00.000Z',
    elapsedMs: 1000,
    ackState: 'local_committed',
    logCursor: null,
    diagnostic: null,
    steps: [],
  };
}
