import type { WatcherPolicyDecision, WatcherServiceAction, WatcherServiceStatus } from './contracts.js';
import { descriptorForCommand, watcherServiceCommandId } from './desktop-command-registry.js';

const SERVICE_CONFIRMATION_TTL_MS = 15_000;
type ServiceActionVariant = 'primary' | 'secondary' | 'danger';

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

interface ServiceActionPresentation {
  readonly order: number;
  readonly variant: ServiceActionVariant;
  readonly visible: boolean;
}

type ProgressStepLabels = Partial<Record<string, string>>;

export function isServiceAction(value: string | undefined): value is WatcherServiceAction {
  return value === 'health' || value === 'install' || value === 'start' || value === 'stop' || value === 'restart' || value === 'check_update' || value === 'update';
}

export function setServiceBusy(buttons: NodeListOf<HTMLButtonElement>, busy: boolean): void {
  Array.from(buttons).forEach(button => {
    button.disabled = busy;
  });
}

export function setServiceActionState(buttons: NodeListOf<HTMLButtonElement>, status: WatcherServiceStatus): void {
  const state = new Map<WatcherServiceAction, ServiceActionPresentation>(serviceActionPresentation(status));
  Array.from(buttons).forEach(button => {
    const action = button.dataset.serviceAction;
    if (!isServiceAction(action)) return;
    const presentation = state.get(action) ?? hiddenAction();
    button.hidden = !presentation.visible;
    button.style.order = String(presentation.order);
    button.dataset.commandVariant = presentation.variant;
    button.dataset.tooltip = serviceActionTooltip(action);
    button.title = serviceActionTooltip(action);
    button.classList.add('icon-button', 'service-icon-button');
    button.classList.toggle('ghost', presentation.variant !== 'primary');
  });
}

export function setServiceConfirmationHint(
  buttons: NodeListOf<HTMLButtonElement>,
  pending: PendingServiceActionConfirmation | null,
): void {
  Array.from(buttons).forEach(button => {
    const action = button.dataset.serviceAction;
    if (!isServiceAction(action)) return;
    const label = pending && pending.action === action
      ? confirmationLabel(action)
      : actionLabel(action);
    button.innerHTML = serviceActionIcon(action);
    button.setAttribute('aria-label', label);
    const tooltip = pending && pending.action === action
      ? `Подтвердить действие: ${serviceActionTooltip(action)}`
      : serviceActionTooltip(action);
    button.dataset.tooltip = tooltip;
    button.title = tooltip;
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
  const labels = { health: 'Проверить подключение', install: 'Установить службу', start: 'Запустить watcher', stop: 'Остановить watcher', restart: 'Перезапустить watcher', check_update: 'Проверить обновления', update: 'Обновить пульт и watcher' };
  return labels[action];
}

export function serviceActionProgressLines(action: WatcherServiceAction, elapsedMs: number): readonly string[] {
  const descriptor = descriptorForCommand(watcherServiceCommandId(action));
  const route = descriptor.progressSteps.map(step => serviceActionStepLabel(action, step));
  return [
    `Выполняем: ${actionLabel(action)}...`,
    `Команда: ${descriptor.id} · риск: ${riskLabel(descriptor.risk)} · timeout: ${formatTimeout(descriptor.timeoutMs)}`,
    `Что происходит сейчас: команда запущена, ждём финальный результат до ${formatTimeout(descriptor.timeoutMs)}.`,
    `Таймер: ${formatElapsed(elapsedMs)} · если команда зависнет, пульт остановит ожидание по timeout.`,
    `Какие данные проверяем: ${descriptor.requiredEvidence.join(', ')}`,
    `Финальный лог покажет: ${serviceActionFinalLog(action)}.`,
    'Маршрут команды (порядок выполнения, не список завершённых событий):',
    ...route.map((label, index) => `${index + 1}/${route.length} ${routeStageLabel(index, route.length)}: ${label}`),
  ];
}

const ACTION_STEP_LABELS: Record<WatcherServiceAction, ProgressStepLabels> = {
  health: {
    preflight: 'Проверяем выбранный проект, bearer и MCP-доступ',
    repair: 'Сверяем launcher, XML и service runtime без ремонта',
    command: 'Запрашиваем состояние Windows-службы watcher',
    health: 'Сравниваем service status, lease и последнюю синхронизацию',
    diagnostics: 'Собираем последние логи и понятную причину статуса',
  },
  install: {
    preflight: 'Проверяем выбранный проект, bearer и MCP-доступ',
    repair: 'Готовим launcher, XML, WinSW wrapper и локальный service runtime',
    command: 'Устанавливаем или обновляем Windows-службу watcher',
    health: 'Проверяем, что служба может перейти в healthy',
    diagnostics: 'Собираем логи установки и первопричину, если служба не стартовала',
  },
  start: {
    preflight: 'Проверяем выбранный проект, bearer и MCP-доступ',
    repair: 'Проверяем launcher, XML и service runtime перед запуском',
    command: 'Запускаем Windows-службу watcher',
    health: 'Ждём healthy, lease и первую синхронизацию',
    diagnostics: 'Собираем логи запуска и первопричину, если healthy не наступил',
  },
  stop: {
    preflight: 'Проверяем выбранный проект и текущий профиль службы',
    repair: 'Сверяем service metadata перед остановкой',
    command: 'Останавливаем Windows-службу watcher',
    health: 'Проверяем, что служба действительно остановлена',
    diagnostics: 'Собираем логи остановки и итоговый статус',
  },
  restart: {
    preflight: 'Проверяем выбранный проект, bearer и MCP-доступ',
    repair: 'Проверяем launcher, XML и service runtime перед перезапуском',
    command: 'Перезапускаем Windows-службу watcher',
    health: 'Ждём healthy, lease и первую синхронизацию после перезапуска',
    diagnostics: 'Собираем логи перезапуска и первопричину, если healthy не наступил',
  },
  check_update: {
    preflight: 'Проверяем текущую версию пульта и watcher',
    github_release: 'Запрашиваем последний GitHub release',
    compare_versions: 'Сравниваем версии и формируем решение об обновлении',
  },
  update: {
    preflight: 'Проверяем текущую версию, профиль проекта и доступ к release',
    download: 'Скачиваем desktop installer и проверяем checksum',
    runtime_install: 'Ставим локальный watcher runtime из release package',
    restart: 'Перезапускаем Windows-службу на новой версии',
    diagnostics: 'Собираем версии, логи установки и итоговый статус службы',
  },
};

function serviceActionStepLabel(action: WatcherServiceAction, step: string): string {
  return ACTION_STEP_LABELS[action][step] ?? step;
}

function routeStageLabel(index: number, total: number): string {
  if (index === 0) return 'Сначала';
  if (index === total - 1) return 'Финал';
  return 'Затем';
}

function serviceActionFinalLog(action: WatcherServiceAction): string {
  const labels = {
    health: 'доступ к MCP-серверу, состояние службы и последние логи',
    install: 'что установлено, где лежит launcher/XML и почему служба готова или не готова',
    start: 'запущена ли служба, получен ли lease и прошла ли первая синхронизация',
    stop: 'остановлена ли служба и какой код вернул WinSW',
    restart: 'перезапустилась ли служба и вернулась ли она в healthy',
    check_update: 'есть ли новая версия, какая версия локально и какая доступна в GitHub release',
    update: 'что скачано, что установлено и какой статус службы после обновления',
  };
  return labels[action];
}

function serviceActionTooltip(action: WatcherServiceAction): string {
  const labels = {
    health: 'Проверить MCP-доступ и состояние службы без изменений',
    install: 'Установить Windows-службу watcher для выбранного проекта',
    start: 'Запустить watcher и начать индексацию выбранного проекта',
    stop: 'Остановить watcher для выбранного проекта',
    restart: 'Перезапустить watcher с текущим профилем проекта',
    check_update: 'Проверить доступность новой версии пульта и watcher',
    update: 'Скачать и запустить обновление пульта и watcher',
  };
  return labels[action];
}

function serviceActionIcon(action: WatcherServiceAction): string {
  const icons = {
    health: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/><path d="m9 12 2 2 4-4"/></svg>',
    install: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
    start: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6Z"/></svg>',
    restart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>',
    check_update: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>',
    update: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3"/><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/></svg>',
  };
  return icons[action];
}

export function decisionLabel(decision: WatcherPolicyDecision): string {
  const labels = { allow: 'Разрешено', prompt: 'Требует подтверждения', deny: 'Запрещено' };
  return labels[decision];
}

function confirmationLabel(action: WatcherServiceAction): string {
  const labels = {
    health: 'Проверить подключение',
    install: 'Подтвердить установку',
    start: 'Подтвердить запуск',
    stop: 'Подтвердить остановку',
    restart: 'Подтвердить перезапуск',
    check_update: 'Проверить обновления',
    update: 'Подтвердить обновление',
  };
  return labels[action];
}

function matchesPendingConfirmation(request: ServiceActionConfirmationRequest): boolean {
  return request.pending !== null
    && request.pending.action === request.action
    && request.pending.projectId === request.projectId
    && request.pending.expiresAt >= request.nowMs;
}

function serviceActionPresentation(status: WatcherServiceStatus): readonly [WatcherServiceAction, ServiceActionPresentation][] {
  if (!status.installed) return [
    ['install', actionState(1, 'primary')],
    ['health', actionState(2, 'secondary')],
    ['check_update', actionState(3, 'secondary')],
    ['update', actionState(4, 'danger')],
  ];
  if (!status.running) return [
    ['start', actionState(1, 'primary')],
    ['health', actionState(2, 'secondary')],
    ['check_update', actionState(3, 'secondary')],
    ['update', actionState(4, 'danger')],
  ];
  return [
    ['health', actionState(1, 'primary')],
    ['restart', actionState(2, 'secondary')],
    ['check_update', actionState(3, 'secondary')],
    ['update', actionState(4, 'danger')],
    ['stop', actionState(5, 'danger')],
  ];
}

function actionState(order: number, variant: ServiceActionVariant): ServiceActionPresentation {
  return { order, variant, visible: true };
}

function hiddenAction(): ServiceActionPresentation {
  return { order: 99, variant: 'secondary', visible: false };
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

function riskLabel(risk: 'low' | 'medium' | 'high'): string {
  const labels = { low: 'низкий', medium: 'средний', high: 'высокий' };
  return labels[risk];
}
