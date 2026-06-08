import type { WatcherPolicyDecision, WatcherServiceAction } from './contracts.js';

const SERVICE_CONFIRMATION_TTL_MS = 15_000;

export interface PendingServiceActionConfirmation {
  readonly action: WatcherServiceAction;
  readonly projectId: string;
  readonly expiresAt: number;
}

export interface ServiceActionConfirmationDecision {
  readonly confirmed: boolean;
  readonly pending: PendingServiceActionConfirmation | null;
  readonly message: string | null;
}

export interface ServiceActionConfirmationRequest {
  readonly action: WatcherServiceAction;
  readonly confirmAction: boolean;
  readonly nowMs: number;
  readonly pending: PendingServiceActionConfirmation | null;
  readonly projectId: string;
}

export function isServiceAction(value: string | undefined): value is WatcherServiceAction {
  return value === 'health' || value === 'install' || value === 'start' || value === 'stop' || value === 'restart';
}

export function setServiceBusy(buttons: NodeListOf<HTMLButtonElement>, busy: boolean): void {
  Array.from(buttons).forEach(button => {
    button.disabled = busy;
  });
}

export function setServiceConfirmationHint(
  buttons: NodeListOf<HTMLButtonElement>,
  pending: PendingServiceActionConfirmation | null,
): void {
  Array.from(buttons).forEach(button => {
    const action = button.dataset.serviceAction;
    if (!isServiceAction(action)) return;
    button.textContent = pending && pending.action === action
      ? confirmationLabel(action)
      : actionLabel(action);
  });
}

export function resolveServiceActionConfirmation(
  request: ServiceActionConfirmationRequest,
): ServiceActionConfirmationDecision {
  if (!request.confirmAction) return { confirmed: true, pending: null, message: null };
  if (matchesPendingConfirmation(request)) return { confirmed: true, pending: null, message: null };
  const pending = {
    action: request.action,
    projectId: request.projectId,
    expiresAt: request.nowMs + SERVICE_CONFIRMATION_TTL_MS,
  };
  return {
    confirmed: false,
    pending,
    message: `Подтвердите действие «${actionLabel(request.action)}» для ${request.projectId}: нажмите эту же кнопку ещё раз в течение 15 секунд.`,
  };
}

export function actionLabel(action: WatcherServiceAction): string {
  const labels = { health: 'Проверить', install: 'Установить службу', start: 'Запустить', stop: 'Остановить', restart: 'Перезапустить' };
  return labels[action];
}

export function decisionLabel(decision: WatcherPolicyDecision): string {
  const labels = { allow: 'Разрешено', prompt: 'Требует подтверждения', deny: 'Запрещено' };
  return labels[decision];
}

function confirmationLabel(action: WatcherServiceAction): string {
  const labels = {
    health: 'Проверить',
    install: 'Подтвердить установку',
    start: 'Подтвердить запуск',
    stop: 'Подтвердить остановку',
    restart: 'Подтвердить перезапуск',
  };
  return labels[action];
}

function matchesPendingConfirmation(request: ServiceActionConfirmationRequest): boolean {
  return request.pending !== null
    && request.pending.action === request.action
    && request.pending.projectId === request.projectId
    && request.pending.expiresAt >= request.nowMs;
}
