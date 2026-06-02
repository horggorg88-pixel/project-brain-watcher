import type { WatcherPolicyDecision, WatcherServiceAction } from './contracts.js';

export function isServiceAction(value: string | undefined): value is WatcherServiceAction {
  return value === 'health' || value === 'install' || value === 'start' || value === 'stop' || value === 'restart';
}

export function setServiceBusy(buttons: NodeListOf<HTMLButtonElement>, busy: boolean): void {
  for (const button of buttons) button.disabled = busy;
}

export function actionLabel(action: WatcherServiceAction): string {
  const labels = { health: 'Проверить', install: 'Установить службу', start: 'Запустить', stop: 'Остановить', restart: 'Перезапустить' };
  return labels[action];
}

export function decisionLabel(decision: WatcherPolicyDecision): string {
  const labels = { allow: 'Разрешено', prompt: 'Требует подтверждения', deny: 'Запрещено' };
  return labels[decision];
}
