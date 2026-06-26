import type { WatcherPolicyDecision, WatcherServiceAction, WatcherServiceStatus } from './contracts.js';
import { descriptorForCommand, watcherServiceCommandId } from './desktop-command-registry.js';
import { iconSvg, type DesktopIconName } from './renderer-icons.js';

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
    const isPendingConfirmation = pending?.action === action;
    const label = isPendingConfirmation
      ? confirmationLabel(action)
      : actionLabel(action);
    button.innerHTML = serviceActionIcon(action);
    button.setAttribute('aria-label', label);
    const tooltip = isPendingConfirmation
      ? `Подтвердить действие: ${serviceActionTooltip(action)}`
      : serviceActionTooltip(action);
    button.toggleAttribute('data-confirmation-pending', isPendingConfirmation);
    if (isPendingConfirmation) {
      if (button.dataset.confirmationPreviousVariant === undefined) {
        button.dataset.confirmationPreviousVariant = button.dataset.commandVariant ?? '';
      }
      button.dataset.commandVariant = 'danger';
    } else if (button.dataset.confirmationPreviousVariant !== undefined) {
      const previousVariant = button.dataset.confirmationPreviousVariant;
      if (previousVariant) {
        button.dataset.commandVariant = previousVariant;
      } else {
        delete button.dataset.commandVariant;
      }
      delete button.dataset.confirmationPreviousVariant;
    }
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

export function serviceActionProgressLines(
  action: WatcherServiceAction,
  elapsedMs: number,
  activeStepIndex?: number,
  status?: WatcherServiceStatus | null,
): readonly string[] {
  const descriptor = descriptorForCommand(watcherServiceCommandId(action));
  const route = descriptor.progressSteps.map(step => serviceActionStepLabel(action, step));
  const settledText = serviceActionSettledText(action, status);
  const statusStep = serviceActionStatusStep(action, status, route.length);
  const safeActiveStepIndex = clampRouteIndex(
    settledText ? route.length : statusStep?.index ?? activeStepIndex ?? estimatedRouteIndex(elapsedMs, descriptor.timeoutMs, route.length),
    route.length,
  );
  const activeStep = settledText ?? statusStep?.text ?? route[safeActiveStepIndex] ?? 'ожидаем финальный результат команды';
  return [
    `Выполняем: ${actionLabel(action)}...`,
    `Команда: ${descriptor.id} · риск: ${riskLabel(descriptor.risk)} · timeout: ${formatTimeout(descriptor.timeoutMs)}`,
    `Что происходит сейчас: ${activeStep}.`,
    `Текущий этап: ${activeStep}`,
    `Таймер: ${formatElapsed(elapsedMs)} · если команда зависнет, пульт остановит ожидание по timeout.`,
    `Какие данные проверяем: ${descriptor.requiredEvidence.join(', ')}`,
    `Финальный лог покажет: ${serviceActionFinalLog(action)}.`,
    'Маршрут команды (полная трасса со статусами):',
    ...route.map((label, index) => (
      `${routeStatusMarker(index, safeActiveStepIndex)} ${index + 1}/${route.length} ${routeStageLabel(index, route.length)}: ${label}`
    )),
  ];
}

export function serviceActionTimeoutMs(action: WatcherServiceAction): number | null {
  return descriptorForCommand(watcherServiceCommandId(action)).timeoutMs;
}

export function serviceActionTimeoutLog(action: WatcherServiceAction, timeoutMs = serviceActionTimeoutMs(action)): string {
  const timeoutText = timeoutMs === null ? 'без лимита' : formatTimeout(timeoutMs);
  return [
    `Команда «${actionLabel(action)}» не завершилась за ${timeoutText}.`,
    'Пульт остановил ожидание локально, чтобы интерфейс не висел на последнем шаге.',
    `Что проверить: ${serviceActionTimeoutHint(action)}`,
  ].join('\n');
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

function routeStatusMarker(index: number, activeStepIndex: number): string {
  if (index < activeStepIndex) return '✓';
  if (index === activeStepIndex) return '●';
  return '○';
}

function clampRouteIndex(value: number, routeLength: number): number {
  if (routeLength <= 0) return 0;
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, Math.trunc(value)), routeLength);
}

function serviceActionSettledText(action: WatcherServiceAction, status: WatcherServiceStatus | null | undefined): string | null {
  if (!status) return null;
  if (action === 'start' && status.running && status.health === 'healthy') {
    return 'Watcher уже работает; визуал и логи синхронизированы';
  }
  if (action === 'stop' && status.installed && !status.running) {
    return 'Watcher уже остановлен; визуал и логи синхронизированы';
  }
  if (action === 'install' && status.installed) {
    return 'Служба уже установлена; визуал и логи синхронизированы';
  }
  return null;
}

function serviceActionStatusStep(
  action: WatcherServiceAction,
  status: WatcherServiceStatus | null | undefined,
  routeLength: number,
): { readonly index: number; readonly text: string } | null {
  if (!status || routeLength < 4) return null;
  if ((action === 'start' || action === 'restart') && status.running) {
    return {
      index: 3,
      text: action === 'restart'
        ? 'Watcher уже перезапущен; ждём healthy, lease и первую синхронизацию'
        : 'Watcher уже запущен; ждём healthy, lease и первую синхронизацию',
    };
  }
  if (action === 'stop' && status.running) {
    return { index: 2, text: 'Команда остановки отправлена; ждём остановку Windows-службы' };
  }
  if (action === 'install' && status.installed && !status.running) {
    return { index: 3, text: 'Служба установлена; проверяем готовность watcher к healthy' };
  }
  return null;
}

function estimatedRouteIndex(elapsedMs: number, timeoutMs: number | null, routeLength: number): number {
  if (routeLength <= 1 || timeoutMs === null || timeoutMs <= 0 || elapsedMs <= 0) return 0;
  const ratio = Math.min(0.98, elapsedMs / timeoutMs);
  return Math.floor(ratio * routeLength);
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

function serviceActionTimeoutHint(action: WatcherServiceAction): string {
  const labels = {
    health: 'MCP-доступ, состояние службы и последние логи диагностики.',
    install: 'права Windows-службы, WinSW wrapper, launcher и runtime-install.log.',
    start: 'Windows-службу watcher, lease, состояние сервера и последние service logs.',
    stop: 'ответ WinSW stop и не остался ли watcher-процесс активным.',
    restart: 'WinSW restart, launcher/XML и переход watcher обратно в healthy.',
    check_update: 'сеть, доступ к GitHub release и повторить «Проверить обновления».',
    update: 'скачивание release, installer/runtime package и runtime-install.log.',
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
  return iconSvg(serviceActionIconName(action));
}

function serviceActionIconName(action: WatcherServiceAction): DesktopIconName {
  const icons: Record<WatcherServiceAction, DesktopIconName> = {
    health: 'activity',
    install: 'download',
    start: 'play',
    stop: 'square',
    restart: 'refresh-cw',
    check_update: 'package-search',
    update: 'upload-cloud',
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
