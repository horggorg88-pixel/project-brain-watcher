import { createHash } from 'node:crypto';
import type {
  DesktopCommandDiagnostic,
  DesktopCommandId,
  DesktopCommandProgressStep,
  DesktopCommandReceipt,
  DesktopCommandStatus,
  DesktopCommandAckState,
} from './desktop-command-contracts.js';
import type {
  WatcherServiceAction,
  WatcherServiceActionProgress,
  WatcherServiceActionProgressStep,
  WatcherServiceActionResult,
  WatcherServiceLogTail,
  WatcherServicePrimaryCause,
} from './contracts.js';
import { descriptorForCommand, watcherServiceCommandId } from './desktop-command-registry.js';

export interface ServiceCommandReceiptInput {
  readonly action: WatcherServiceAction;
  readonly result: WatcherServiceActionResult;
  readonly receivedAt?: string;
}

export interface DesktopCommandReceiptInput {
  readonly commandId: DesktopCommandId;
  readonly projectId: string;
  readonly status: DesktopCommandStatus;
  readonly startedAt?: string;
  readonly updatedAt?: string;
  readonly elapsedMs?: number | null;
  readonly ackState?: DesktopCommandAckState;
  readonly logCursor?: string | null;
  readonly diagnostic?: DesktopCommandDiagnostic | null;
  readonly steps?: readonly DesktopCommandProgressStep[];
}

export function attachServiceCommandReceipt(
  action: WatcherServiceAction,
  result: WatcherServiceActionResult,
  receivedAt = new Date().toISOString(),
): WatcherServiceActionResult {
  return {
    ...result,
    receipt: buildServiceCommandReceipt({ action, result, receivedAt }),
  };
}

export function buildServiceCommandReceipt(input: ServiceCommandReceiptInput): DesktopCommandReceipt {
  const commandId = watcherServiceCommandId(input.action);
  const updatedAt = input.receivedAt ?? new Date().toISOString();
  const startedAt = input.result.progress?.startedAt ?? updatedAt;
  const projectId = input.result.status.projectId ?? 'unknown-project';
  return buildDesktopCommandReceipt({
    commandId,
    projectId,
    status: serviceCommandStatus(input.result),
    startedAt,
    updatedAt,
    elapsedMs: input.result.commandStatus?.durationMs ?? input.result.progress?.elapsedMs ?? null,
    ackState: 'local_committed',
    logCursor: serviceLogCursor(input.result.status.logs),
    diagnostic: serviceCommandDiagnostic(input.result),
    steps: serviceCommandSteps(commandId, input.result.progress),
  });
}

export function buildDesktopCommandReceipt(input: DesktopCommandReceiptInput): DesktopCommandReceipt {
  const descriptor = descriptorForCommand(input.commandId);
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const startedAt = input.startedAt ?? updatedAt;
  const diagnostic = input.diagnostic ?? null;
  const steps = input.steps ?? descriptor.progressSteps.map(id => ({
    id,
    label: id,
    status: 'pending',
    detail: 'step не запускался',
  }));
  const elapsedMs = input.elapsedMs ?? null;
  const runId = commandRunId(input.commandId, input.projectId, startedAt, elapsedMs);
  const receiptBase = {
    runId,
    commandId: input.commandId,
    projectId: input.projectId,
    status: input.status,
    updatedAt,
    diagnosticCode: diagnostic?.code ?? null,
  };
  return {
    version: 'desktop-command-receipt/v1',
    receiptId: `dcr_${hashPayload(receiptBase).slice(0, 20)}`,
    runId,
    commandId: input.commandId,
    projectId: input.projectId,
    surface: descriptor.surface,
    category: descriptor.category,
    status: input.status,
    risk: descriptor.risk,
    startedAt,
    updatedAt,
    elapsedMs,
    ackState: input.ackState ?? 'local_committed',
    logCursor: input.logCursor ?? null,
    diagnostic,
    steps,
  };
}

export function serviceCommandStatus(result: WatcherServiceActionResult): DesktopCommandStatus {
  if (result.commandStatus?.timedOut) return 'timed_out';
  if (result.policy.decision === 'deny') return 'blocked';
  if (result.policy.decision === 'prompt') return 'waiting';
  if (result.exitCode === 0) return 'passed';
  if (result.commandStatus?.status === 'spawn_error') return 'failed';
  if (result.exitCode === null) return result.executed ? 'running' : 'unavailable';
  return 'failed';
}

function serviceCommandDiagnostic(result: WatcherServiceActionResult): DesktopCommandDiagnostic | null {
  const cause = result.primaryCause ?? result.progress?.primaryCause ?? null;
  if (cause) return primaryCauseDiagnostic(cause);
  if (result.policy.decision === 'deny' || result.policy.decision === 'prompt') {
    return {
      code: `POLICY_${result.policy.decision.toUpperCase()}`,
      severity: result.policy.decision === 'deny' ? 'error' : 'warning',
      title: result.policy.decision === 'deny' ? 'Команда заблокирована policy' : 'Команда ждёт подтверждения',
      detail: result.policy.reasons.join('; ') || 'Policy не разрешила автоматическое выполнение.',
      nextAction: result.policy.decision === 'deny' ? 'Исправь причины policy и повтори команду.' : 'Подтверди действие в пульте.',
      evidenceRefs: ['policy.gate'],
    };
  }
  if (result.exitCode !== 0 && result.exitCode !== null) {
    return {
      code: 'COMMAND_FAILED',
      severity: 'error',
      title: 'Команда завершилась с ошибкой',
      detail: `exitCode=${result.exitCode}`,
      nextAction: 'Открой receipt, progress и последние логи команды.',
      evidenceRefs: ['command.status', 'service.logs'],
    };
  }
  return null;
}

function primaryCauseDiagnostic(cause: WatcherServicePrimaryCause): DesktopCommandDiagnostic {
  return {
    code: cause.code,
    severity: cause.severity,
    title: cause.title,
    detail: cause.detail,
    nextAction: cause.nextAction,
    evidenceRefs: ['service.primary_cause', 'service.logs'],
  };
}

function serviceCommandSteps(
  commandId: DesktopCommandId,
  progress: WatcherServiceActionProgress | undefined,
): readonly DesktopCommandProgressStep[] {
  if (progress) return progress.steps.map(serviceStepToCommandStep);
  return descriptorForCommand(commandId).progressSteps.map(id => ({
    id,
    label: id,
    status: 'pending',
    detail: 'step не запускался',
  }));
}

function serviceStepToCommandStep(step: WatcherServiceActionProgressStep): DesktopCommandProgressStep {
  return {
    id: step.id,
    label: step.label,
    status: step.status,
    detail: step.detail,
  };
}

function serviceLogCursor(logs: WatcherServiceLogTail | null): string | null {
  const stream = logs?.transport.streams.find(candidate => candidate.id === 'err' && (candidate.tailCursor ?? candidate.firstCursor))
    ?? logs?.transport.streams.find(candidate => candidate.id === 'runtime_install' && (candidate.tailCursor ?? candidate.firstCursor))
    ?? logs?.transport.streams.find(candidate => candidate.id === 'wrapper' && (candidate.tailCursor ?? candidate.firstCursor))
    ?? logs?.transport.streams.find(candidate => candidate.tailCursor ?? candidate.firstCursor);
  if (!stream) return null;
  return `${stream.id}:${stream.tailCursor ?? stream.firstCursor}`;
}

function commandRunId(
  commandId: DesktopCommandId,
  projectId: string,
  startedAt: string,
  durationMs: number | null,
): string {
  return `dcrun_${hashPayload({ commandId, projectId, startedAt, durationMs }).slice(0, 18)}`;
}

function hashPayload(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
