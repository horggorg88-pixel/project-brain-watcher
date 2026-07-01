import { describe, expect, it } from 'vitest';
import {
  buildDesktopLogReceiptPair,
  redactDesktopServiceStatus,
  redactDesktopLogText,
  redactDesktopLogTextWithReceipt,
} from '../../apps/watcher-desktop/src/desktop-log-redaction.js';
import type { WatcherServiceStatus } from '../../apps/watcher-desktop/src/contracts.js';

const SECRET_FIXTURE = [
  'Authorization: Bearer pb_should_not_leak_1234567890',
  'Bearer sk-should-not-leak-123456',
  'OPENAI_API_KEY="sk-openai-secret-value"',
  'ANTHROPIC_API_KEY=sk-ant-secret-value',
  'TOKEN=token-secret-value',
  'password: plain-password-secret',
  '{"token":"json-secret-value","api_key":"json-api-key-secret"}',
  'safe line',
].join('\n');

const SECRET_NEEDLES = [
  'pb_should_not_leak',
  'should-not-leak',
  'sk-openai-secret-value',
  'sk-ant-secret-value',
  'token-secret-value',
  'plain-password-secret',
  'json-secret-value',
  'json-api-key-secret',
] as const;

describe('watcher desktop log redaction', () => {
  it('uses one redactor for human logs and AI context receipts', () => {
    const pair = buildDesktopLogReceiptPair(SECRET_FIXTURE);

    expect(pair.human.profile).toBe('human');
    expect(pair.ai.profile).toBe('ai');
    expect(pair.human.redacted).toBe(true);
    expect(pair.ai.redacted).toBe(true);
    expect(pair.human.replacementCount).toBeGreaterThanOrEqual(7);
    expect(pair.ai.replacementCount).toBe(pair.human.replacementCount);
    expect(pair.ai.text).toBe(pair.human.text);
    expect(pair.human.text).toContain('Authorization: Bearer [REDACTED]');
    expect(pair.human.text).toContain('TOKEN=[REDACTED]');
    expect(pair.human.text).toContain('"token":"[REDACTED]"');
    for (const needle of SECRET_NEEDLES) {
      expect(pair.human.text).not.toContain(needle);
      expect(pair.ai.text).not.toContain(needle);
    }
  });

  it('keeps the compatibility helpers on the same redaction path', () => {
    const text = redactDesktopLogText(SECRET_FIXTURE);
    const receipt = redactDesktopLogTextWithReceipt(SECRET_FIXTURE, 'human');

    expect(receipt.text).toBe(text);
    expect(receipt.redacted).toBe(true);
    expect(receipt.profile).toBe('human');
    for (const needle of SECRET_NEEDLES) expect(text).not.toContain(needle);
  });

  it('redacts service status fields before they are copied into AI context', () => {
    const status: WatcherServiceStatus = {
      installed: true,
      running: false,
      readOnly: true,
      health: 'stopped',
      projectId: 'client-project',
      root: 'C:/Project',
      pid: null,
      queueDepth: 0,
      lastSyncAt: null,
      lastError: `Windows Service STOPPED TOKEN=token-secret-value ${SECRET_FIXTURE}`,
      logs: {
        wrapperPath: 'wrapper.log',
        outPath: 'out.log',
        errPath: 'err.log',
        runtimeInstallPath: 'runtime-install.log',
        wrapper: SECRET_FIXTURE,
        out: SECRET_FIXTURE,
        err: SECRET_FIXTURE,
        runtimeInstall: SECRET_FIXTURE,
        transport: {
          version: 'watcher-log-transport/v1',
          chunkSizeBytes: 24_000,
          streams: [],
        },
      },
    };

    const redacted = redactDesktopServiceStatus(status);
    const serialized = JSON.stringify(redacted);

    expect(redacted?.lastError).toContain('TOKEN=[REDACTED]');
    expect(redacted?.logs?.out).toContain('Authorization: Bearer [REDACTED]');
    for (const needle of SECRET_NEEDLES) expect(serialized).not.toContain(needle);
  });
});
