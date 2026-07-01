import type { DesktopCommandDescriptor } from './desktop-command-contracts.js';

export type DesktopCommandRouteStageStatus = 'passed' | 'active' | 'waiting';
export type DesktopCommandRouteMarker = '✓' | '●' | '○';
export type DesktopCommandRouteOrdinal = 'Сначала' | 'Затем' | 'Финал';

export interface DesktopCommandRouteSnapshotInput {
  readonly descriptor: DesktopCommandDescriptor;
  readonly elapsedMs: number;
  readonly stepLabels?: Readonly<Partial<Record<string, string>>>;
  readonly activeStepId?: string | null;
  readonly activeStepIndex?: number;
  readonly settledText?: string | null;
  readonly currentText?: string | null;
  readonly finalLog?: string;
}

export interface DesktopCommandRouteStage {
  readonly id: string;
  readonly label: string;
  readonly index: number;
  readonly total: number;
  readonly status: DesktopCommandRouteStageStatus;
  readonly marker: DesktopCommandRouteMarker;
  readonly ordinal: DesktopCommandRouteOrdinal;
}

export interface DesktopCommandRouteSnapshot {
  readonly commandId: string;
  readonly currentStepId: string | null;
  readonly currentText: string;
  readonly elapsedText: string;
  readonly timeoutText: string;
  readonly evidenceText: string;
  readonly finalLog: string;
  readonly stages: readonly DesktopCommandRouteStage[];
}

export function buildDesktopCommandRouteSnapshot(
  input: DesktopCommandRouteSnapshotInput,
): DesktopCommandRouteSnapshot {
  const route = input.descriptor.progressSteps;
  const activeIndex = input.settledText
    ? Math.max(0, route.length - 1)
    : resolveActiveRouteIndex(input, route);
  const stages = route.map((id, index) => buildRouteStage({
    id,
    label: input.stepLabels?.[id] ?? input.descriptor.progressText.labels[id] ?? id,
    index,
    total: route.length,
    activeIndex,
    settled: Boolean(input.settledText),
  }));
  const currentStage = stages[activeIndex] ?? null;

  return {
    commandId: input.descriptor.id,
    currentStepId: currentStage?.id ?? null,
    currentText: input.settledText ?? input.currentText ?? currentStage?.label ?? 'ожидаем финальный результат команды',
    elapsedText: formatElapsed(input.elapsedMs),
    timeoutText: formatTimeout(input.descriptor.timeoutMs),
    evidenceText: input.descriptor.requiredEvidence.join(', '),
    finalLog: input.finalLog ?? input.descriptor.progressText.finalLog,
    stages,
  };
}

function buildRouteStage(input: {
  readonly id: string;
  readonly label: string;
  readonly index: number;
  readonly total: number;
  readonly activeIndex: number;
  readonly settled: boolean;
}): DesktopCommandRouteStage {
  const status = routeStageStatus(input.index, input.activeIndex, input.settled);
  return {
    id: input.id,
    label: input.label,
    index: input.index,
    total: input.total,
    status,
    marker: routeMarker(status),
    ordinal: routeOrdinal(input.index, input.total),
  };
}

function resolveActiveRouteIndex(
  input: DesktopCommandRouteSnapshotInput,
  route: readonly string[],
): number {
  const explicitStepIndex = input.activeStepId ? route.indexOf(input.activeStepId) : -1;
  const candidate = explicitStepIndex >= 0
    ? explicitStepIndex
    : input.activeStepIndex ?? estimatedRouteIndex(input.elapsedMs, input.descriptor.timeoutMs, route.length);
  return clampRouteIndex(candidate, route.length);
}

function routeStageStatus(
  index: number,
  activeIndex: number,
  settled: boolean,
): DesktopCommandRouteStageStatus {
  if (settled || index < activeIndex) return 'passed';
  if (index === activeIndex) return 'active';
  return 'waiting';
}

function routeMarker(status: DesktopCommandRouteStageStatus): DesktopCommandRouteMarker {
  if (status === 'passed') return '✓';
  if (status === 'active') return '●';
  return '○';
}

function routeOrdinal(index: number, total: number): DesktopCommandRouteOrdinal {
  if (index === 0) return 'Сначала';
  if (index === total - 1) return 'Финал';
  return 'Затем';
}

function estimatedRouteIndex(elapsedMs: number, timeoutMs: number | null, routeLength: number): number {
  if (routeLength <= 1 || timeoutMs === null || timeoutMs <= 0 || elapsedMs <= 0) return 0;
  return Math.floor(Math.min(0.98, elapsedMs / timeoutMs) * routeLength);
}

function clampRouteIndex(value: number, routeLength: number): number {
  if (routeLength <= 0 || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, Math.trunc(value)), routeLength - 1);
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatTimeout(timeoutMs: number | null): string {
  return timeoutMs === null ? 'без лимита' : formatElapsed(timeoutMs);
}
