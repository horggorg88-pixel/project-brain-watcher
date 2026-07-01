import type { WatcherServiceLogTail, WatcherServiceStatus } from './contracts.js';

export type DesktopLogRedactionProfile = 'human' | 'ai';

export interface DesktopLogRedactionReceipt {
  readonly profile: DesktopLogRedactionProfile;
  readonly text: string;
  readonly redacted: boolean;
  readonly replacementCount: number;
}

export interface DesktopLogReceiptPair {
  readonly human: DesktopLogRedactionReceipt;
  readonly ai: DesktopLogRedactionReceipt;
}

const SECRET_PATTERNS: readonly [RegExp, string][] = [
  [/\bAuthorization:\s*Bearer\s+[^\s"',;}]+/gi, 'Authorization: Bearer [REDACTED]'],
  [/\bBearer\s+(?:sk-[A-Za-z0-9._~+/=-]+|pb_[A-Za-z0-9._~+/=-]+|[A-Za-z0-9._~+/=-]{16,})/gi, 'Bearer [REDACTED]'],
  [/\bpb_[A-Za-z0-9._-]{8,}\b/g, 'pb_[REDACTED]'],
  [/\bsk-[A-Za-z0-9._-]{8,}/g, 'sk-[REDACTED]'],
  [/("(?:(?:access|api)[_-]?)?(?:token|secret|password|key)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2'],
  [
    /\b((?:MCP_BEARER_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|API[_-]?KEY|TOKEN|SECRET|PASSWORD|KEY)\s*[=:]\s*)(["']?)[^\s"',;}]+/gi,
    '$1$2[REDACTED]',
  ],
  [/\b((?:password|secret|token|key)\s*:\s*)(["']?)[^\s"',;}]+/gi, '$1$2[REDACTED]'],
];

export function redactDesktopLogText(value: string): string {
  return redactDesktopLogTextWithReceipt(value, 'human').text;
}

export function redactDesktopLogTextWithReceipt(
  value: string,
  profile: DesktopLogRedactionProfile,
): DesktopLogRedactionReceipt {
  const result = SECRET_PATTERNS.reduce(
    (current, [pattern, replacement]) => {
      const matches = current.text.match(pattern);
      return {
        text: current.text.replace(pattern, replacement),
        replacementCount: current.replacementCount + (matches?.length ?? 0),
      };
    },
    { text: value, replacementCount: 0 },
  );
  return {
    profile,
    text: result.text,
    redacted: result.replacementCount > 0,
    replacementCount: result.replacementCount,
  };
}

export function buildDesktopLogReceiptPair(value: string): DesktopLogReceiptPair {
  const human = redactDesktopLogTextWithReceipt(value, 'human');
  return {
    human,
    ai: {
      ...human,
      profile: 'ai',
    },
  };
}

export function redactDesktopServiceStatus(status: WatcherServiceStatus | null): WatcherServiceStatus | null {
  if (!status) return null;
  return {
    ...status,
    lastError: status.lastError ? redactDesktopLogText(status.lastError) : null,
    logs: status.logs ? redactDesktopServiceLogTail(status.logs) : null,
  };
}

function redactDesktopServiceLogTail(logs: WatcherServiceLogTail): WatcherServiceLogTail {
  return {
    ...logs,
    wrapper: redactDesktopLogText(logs.wrapper),
    out: redactDesktopLogText(logs.out),
    err: redactDesktopLogText(logs.err),
    runtimeInstall: redactDesktopLogText(logs.runtimeInstall),
  };
}
