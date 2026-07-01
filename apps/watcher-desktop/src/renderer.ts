import type {
  DesktopAccessState,
  DesktopCheckAction,
  DesktopCommandReceipt,
  DesktopCodexGateRunEvidence,
  DesktopConfigPackage,
  DesktopConfigSaveResult,
  DesktopConnectionCheck,
  DesktopModeSummary,
  DesktopSection,
  DesktopUiState,
  DiagnosticsPreview,
  ProjectDraft,
  ProjectImportResult,
  SavedProjectProfile,
  WatcherServiceAction,
  WatcherServiceActionRequest,
  WatcherServiceActionProgress,
  WatcherServiceActionResult,
  WatcherServiceLogStream,
  WatcherServiceLogTail,
  WatcherServicePrimaryCause,
  WatcherServiceStatus,
} from './contracts.js';
import {
  applyUiState,
  connectionServerVerified,
  errorMessage,
  fallbackStatus as fallbackServiceStatus,
  formatAccessGateDiagnostics,
  formatCodexGateDiagnostics,
  formatSupportEnrollmentLog,
  renderConfigPackage,
  renderConnectionCheck,
  renderConnectionCause,
  renderModes,
  renderOverall,
  renderProjectSelect,
  renderService,
  renderShellAccess,
  sectionFrom,
  setText,
  withCodexGateProgress,
} from './renderer-view.js';
import { actionLabel, decisionLabel, isServiceAction, serviceActionProgressLines, serviceActionTimeoutLog, serviceActionTimeoutMs, setServiceActionState, setServiceBusy } from './renderer-service-ui.js';
import {
  resolveServiceActionConfirmation,
  setServiceConfirmationHint,
  type PendingServiceActionConfirmation,
} from './renderer-service-ui.js';
import { serviceCommandStatusLine } from './renderer-service-command-status.js';
import { iconSvg, isDesktopIconName } from './renderer-icons.js';
import {
  redactDesktopServiceStatus,
  redactDesktopLogText,
  redactDesktopLogTextWithReceipt,
} from './desktop-log-redaction.js';
import { buildDesktopCommandRouteSnapshot } from './desktop-command-route.js';
import { desktopCheckActionCommandId, descriptorForCommand } from './desktop-command-registry.js';

const POST_SERVICE_ACTION_REFRESH_TIMEOUT_MS = 2_000;

declare global {
  interface Window {
    readonly watcherDesktop: import('./contracts.js').WatcherDesktopApi;
  }
}

interface DesktopAiDiagnostic {
  readonly code: string; readonly severity: 'info' | 'warn' | 'error'; readonly message: string; readonly cause: string; readonly impact: string; readonly nextAction: string;
}

interface DesktopAiRailNode {
  readonly id: string; readonly label: string; readonly status: 'ready' | 'waiting' | 'blocked'; readonly evidence: string;
}

interface DesktopAiRailMap {
  readonly version: 'watcher-rail-map/v1'; readonly required_next: string; readonly rails: readonly DesktopAiRailNode[];
  readonly machine_contract: {
    readonly read_order: readonly string[];
    readonly completion_rule: string;
    readonly redaction: 'required';
    readonly chunking: 'cursor-or-tail';
    readonly output_profiles: {
      readonly human: { readonly surface: string; readonly purpose: string };
      readonly machine: { readonly surface: string; readonly schema: string };
      readonly ai: { readonly surface: string; readonly schema: 'watcher-ai-context/v1' };
    };
    readonly artifact_policy: {
      readonly log_text: 'tail-bounded-redacted';
      readonly copy_target: 'ai_context_bundle';
    };
  };
}

const authForm = document.querySelector<HTMLFormElement>('[data-auth-form]');
const authStatusEl = document.querySelector<HTMLElement>('[data-auth-status]');
const accountEl = document.querySelector<HTMLElement>('[data-profile-card]');
const appShellEl = document.querySelector<HTMLElement>('[data-app-shell]');
const loginScreenEl = document.querySelector<HTMLElement>('[data-login-screen]');
const navButtons = document.querySelectorAll<HTMLButtonElement>('[data-nav-section]');
const sections = document.querySelectorAll<HTMLElement>('[data-section]');
const projectSelect = document.querySelector<HTMLSelectElement>('[data-project-select]');
const selectRootButton = document.querySelector<HTMLButtonElement>('[data-select-root]');
const removeProjectButton = document.querySelector<HTMLButtonElement>('[data-remove-project]');
const downloadConfigButton = document.querySelector<HTMLButtonElement>('[data-download-config]');
const copyPromptButton = document.querySelector<HTMLButtonElement>('[data-copy-prompt]');
const copyServiceLogsButton = document.querySelector<HTMLButtonElement>('[data-copy-service-logs]');
const toggleThemeButton = document.querySelector<HTMLButtonElement>('[data-toggle-theme]');
const runFullCheckButton = document.querySelector<HTMLButtonElement>('[data-run-full-check]');
const consoleToggleButton = document.querySelector<HTMLButtonElement>('[data-console-toggle]');
const bottomConsoleEl = document.querySelector<HTMLElement>('[data-bottom-console]');
const checklistEl = document.querySelector<HTMLElement>('[data-checklist]');
const connectionCauseEl = document.querySelector<HTMLElement>('[data-connection-cause]');
const overallStatusEl = document.querySelector<HTMLElement>('[data-overall-status]');
const serviceSummaryEl = document.querySelector<HTMLElement>('[data-service-summary]');
const serviceStatusEl = document.querySelector<HTMLElement>('[data-service-status]');
const serviceOutputEl = document.querySelector<HTMLElement>('[data-service-output]');
const serviceButtons = document.querySelectorAll<HTMLButtonElement>('[data-service-action]');
const promptEl = document.querySelector<HTMLElement>('[data-start-prompt]');
const modesEl = document.querySelector<HTMLElement>('[data-modes]');
const windowTitlebarEl = document.querySelector<HTMLElement>('[data-window-titlebar]');
const floatingTooltipEl = document.querySelector<HTMLElement>('[data-floating-tooltip]');
const appVersionEls = document.querySelectorAll<HTMLElement>('[data-app-version]');

let accessState: DesktopAccessState | null = null;
let uiState: DesktopUiState = defaultUiState();
let currentProjects: readonly SavedProjectProfile[] = [];
let currentModes: readonly DesktopModeSummary[] = [];
let activeModeId: string | null = null;
let currentPackage: DesktopConfigPackage | null = null;
let currentConnectionCheck: DesktopConnectionCheck | null = null;
let currentServiceStatus: WatcherServiceStatus | null = null;
let pendingServiceAction: PendingServiceActionConfirmation | null = null;
let automaticCodexGateRunning = false;
let codexGateVerificationProjectId: string | null = null;
let refreshInFlight: Promise<void> | null = null;
let automaticSupportEnrollmentRunning = false;
const automaticCodexGateAttempts = new Set<string>();
const automaticSupportEnrollmentAttempts = new Map<string, number>();
const serverHeartbeatRefreshMs = 60 * 1000;
const SERVICE_AI_LOG_CHUNK_LIMIT = 6;
const SERVICE_AI_COMMAND_TEXT_LIMIT = 24_000;
const SERVICE_AI_CONTEXT_TEXT_LIMIT = 120_000;
const supportEnrollmentRetryMs = 2 * 60 * 1000;

hydrateStaticIcons();
void renderAppVersion();
void refresh();
window.setInterval(() => {
  if (accessState?.signedIn) void refresh();
}, serverHeartbeatRefreshMs);

authForm?.addEventListener('submit', event => {
  event.preventDefault();
  const form = new FormData(authForm);
  setText(authStatusEl, 'Проверяем доступ и локальный файл настройки MCP...');
  void window.watcherDesktop.access.login({
    email: String(form.get('email') ?? ''),
    password: String(form.get('password') ?? ''),
  }).then(state => {
    accessState = state;
    if (state.signedIn) authForm.reset();
    automaticSupportEnrollmentAttempts.clear();
    writeLog(formatAccessGateDiagnostics(state));
    return refresh();
  }).catch(error => setText(authStatusEl, errorMessage(error)));
});

accountEl?.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>('[data-access-logout]');
  if (!button) return;
  button.disabled = true;
  void window.watcherDesktop.access.logout()
    .then(state => {
      accessState = state;
      return saveUiState({ ...uiState, activeSection: 'start' });
    })
    .then(() => refresh())
    .catch(error => setText(authStatusEl, errorMessage(error)))
    .finally(() => { button.disabled = false; });
});

navButtons.forEach(button => {
  button.addEventListener('click', () => {
    const activeSection = sectionFrom(button.dataset.navSection);
    if (!activeSection) return;
    void goToSection(activeSection);
  });
});

projectSelect?.addEventListener('change', () => {
  void saveUiState({ ...uiState, lastProjectId: projectSelect.value || null }).then(() => refresh());
});

document.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const toggle = target.closest<HTMLButtonElement>('[data-custom-select-toggle]');
  if (toggle) {
    event.preventDefault();
    toggleCustomSelect(toggle);
    return;
  }

  const projectOption = target.closest<HTMLButtonElement>('[data-project-option]');
  if (projectOption) {
    event.preventDefault();
    selectProjectOption(projectOption);
    return;
  }

  const modeOption = target.closest<HTMLButtonElement>('[data-mode-option]');
  if (modeOption) {
    event.preventDefault();
    selectModeOption(modeOption);
    return;
  }

  closeCustomSelects();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeCustomSelects();
});

document.addEventListener('pointerover', event => {
  showTooltipFromTarget(event.target);
});

document.addEventListener('pointerout', event => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest<HTMLElement>('[data-tooltip]');
  if (!anchor) return;
  const related = event.relatedTarget;
  if (related instanceof Element && anchor.contains(related)) return;
  hideTooltip();
});

document.addEventListener('focusin', event => {
  showTooltipFromTarget(event.target);
});

document.addEventListener('focusout', () => {
  hideTooltip();
});

window.addEventListener('resize', hideTooltip);
window.addEventListener('scroll', hideTooltip, true);

selectRootButton?.addEventListener('click', () => {
  void selectProjectRootFromDialog().catch(error => writeLog(errorMessage(error)));
});

removeProjectButton?.addEventListener('click', () => {
  void removeSelectedProjectFromConsole().catch(error => writeLog(errorMessage(error)));
});

downloadConfigButton?.addEventListener('click', () => {
  void saveCurrentConfigPackage();
});

copyPromptButton?.addEventListener('click', () => {
  void copyText(currentPackage?.prompt ?? '')
    .then(() => writeLog('Стартовый prompt скопирован'))
    .catch(error => writeLog(errorMessage(error)));
});

copyServiceLogsButton?.addEventListener('click', () => {
  void serviceAiLogsText()
    .then(text => copyText(text))
    .then(() => writeLog('AI snapshot логов службы скопирован'))
    .catch(error => writeLog(errorMessage(error)));
});

toggleThemeButton?.addEventListener('click', () => {
  const theme = uiState.theme === 'light' ? 'dark' : 'light';
  void saveUiState({ ...uiState, theme }).then(() => renderUiState());
});

consoleToggleButton?.addEventListener('click', () => {
  void saveUiState({ ...uiState, consoleOpen: !uiState.consoleOpen }).then(() => renderUiState());
});

modesEl?.addEventListener('change', event => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const select = target.closest<HTMLSelectElement>('[data-mode-select]');
  if (!select) return;
  setActiveMode(select.value);
});

modesEl?.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>('[data-mode-step]');
  if (!button) return;
  const direction = button.dataset.modeStep;
  if (direction === 'prev' || direction === 'next') stepActiveMode(direction);
});

windowTitlebarEl?.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>('[data-window-control]');
  const control = button?.dataset.windowControl;
  if (!button || !control) return;
  button.blur();
  if (control === 'minimize') void window.watcherDesktop.windowControls.minimize();
  if (control === 'maximize') void window.watcherDesktop.windowControls.toggleMaximize();
  if (control === 'close') void window.watcherDesktop.windowControls.close();
});

runFullCheckButton?.addEventListener('click', () => {
  void runFullCheckFromUi().catch(error => writeLog(errorMessage(error)));
});

checklistEl?.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>('[data-check-action]');
  if (!button) return;
  void handleCheckAction(button.dataset.checkAction).catch(error => writeLog(errorMessage(error)));
});

serviceButtons.forEach(button => {
  button.addEventListener('click', () => {
    const action = button.dataset.serviceAction;
    if (!isServiceAction(action)) return;
    void runServiceActionFromUi(action, action !== 'health' && action !== 'check_update');
  });
});

async function handleCheckAction(value: string | undefined): Promise<void> {
  const action = checkActionFrom(value);
  if (!action || action === 'none') return;
  switch (action) {
    case 'select_project':
      await selectProjectRootFromDialog();
      return;
    case 'import_config':
      await importConfigFromDialog();
      return;
    case 'download_config':
      await saveCurrentConfigPackage();
      return;
    case 'install_service':
      await runServiceActionFromUi('install', true);
      return;
    case 'start_service':
      await runServiceActionFromUi('start', true);
      return;
    case 'verify':
      writeLog(checkActionRouteStartLog(action));
      await refresh();
      writeLog('Проверка завершена. Результат обновлён в обзорном чеклисте.');
      return;
    case 'verify_codex_gates': {
      const projectId = currentProjectId();
      codexGateVerificationProjectId = projectId;
      writeLog(checkActionRouteStartLog(action));
      await refresh();
      try {
        const result = await window.watcherDesktop.codexGates.verify(projectId);
        writeLog(formatCodexGateDiagnostics(result, projectId));
      } finally {
        codexGateVerificationProjectId = null;
        await refresh();
      }
      return;
    }
    case 'open_logs':
      await openServiceLogs();
      return;
  }
}

function checkActionRouteStartLog(action: DesktopCheckAction): string {
  const commandId = desktopCheckActionCommandId(action);
  if (!commandId) return 'Выполняем действие пульта...';
  const descriptor = descriptorForCommand(commandId);
  const route = buildDesktopCommandRouteSnapshot({ descriptor, elapsedMs: 0 });
  return [
    `Выполняем: ${descriptor.label}...`,
    `Команда: ${descriptor.id} · глобальный рельс: ${descriptor.globalActionId} · риск: ${commandRiskLabel(descriptor.risk)} · timeout: ${route.timeoutText}`,
    `Что происходит сейчас: ${route.currentText}.`,
    `Какие данные проверяем: ${route.evidenceText}`,
    `Финальный лог покажет: ${route.finalLog}.`,
    'Маршрут команды (полная трасса со статусами):',
    ...route.stages.map(stage => `${stage.marker} ${stage.index + 1}/${stage.total} ${stage.ordinal}: ${stage.label}`),
  ].join('\n');
}

function commandRiskLabel(risk: 'low' | 'medium' | 'high'): string {
  const labels = { low: 'низкий', medium: 'средний', high: 'высокий' };
  return labels[risk];
}

async function runFullCheckFromUi(): Promise<void> {
  if (runFullCheckButton) runFullCheckButton.disabled = true;
  writeLog([
    'Выполняем: Проверить контур MCP...',
    `Проект: ${currentProjectId() || 'не выбран'}`,
    'Что проверяем: проект, MCP config, барьер-ключ, MCP-сервер, watcher и необязательные Codex gates.',
    'Лог обновится после ответа проверки.',
  ].join('\n'));
  try {
    await refresh();
    writeLog(connectionCheckLog(currentConnectionCheck));
  } finally {
    if (runFullCheckButton) runFullCheckButton.disabled = false;
  }
}

async function runServiceActionFromUi(action: WatcherServiceAction, confirmAction: boolean): Promise<void> {
  const projectId = currentProjectId();
  const confirmation = resolveServiceActionConfirmation({
    action,
    confirmAction,
    nowMs: Date.now(),
    pending: pendingServiceAction,
    projectId,
  });
  pendingServiceAction = confirmation.pending;
  setServiceConfirmationHint(serviceButtons, pendingServiceAction);
  if (!confirmation.confirmed) {
    if (confirmation.message) writeLog(confirmation.message);
    return;
  }
  setServiceBusy(serviceButtons, true);
  const stopProgress = startServiceActionProgress(action);
  let progressStopped = false;
  const stopActionProgress = (): void => {
    if (progressStopped) return;
    progressStopped = true;
    stopProgress();
  };
  try {
    const result = await runServiceActionWithUiTimeout({ action, projectId, confirmed: true });
    stopActionProgress();
    writeLog(serviceActionLog(result));
    queuePostServiceActionRefresh(action);
  } catch (error) {
    stopActionProgress();
    writeLog(errorMessage(error));
  } finally {
    stopActionProgress();
    setServiceBusy(serviceButtons, false);
    setServiceConfirmationHint(serviceButtons, pendingServiceAction);
  }
}

function runServiceActionWithUiTimeout(request: WatcherServiceActionRequest): Promise<WatcherServiceActionResult> {
  const timeoutMs = serviceActionTimeoutMs(request.action);
  const actionPromise = window.watcherDesktop.service.run(request);
  if (timeoutMs === null) return actionPromise;
  return new Promise<WatcherServiceActionResult>((resolve, reject) => {
    let timedOut = false;
    const timeoutHandle = window.setTimeout(() => {
      timedOut = true;
      reject(new Error(serviceActionTimeoutWithLateCompletionLog(request.action, timeoutMs)));
      queuePostServiceActionRefresh(request.action);
    }, timeoutMs);

    actionPromise
      .then(result => {
        if (timedOut) {
          writeLog(lateServiceActionCompletionLog(request.action, result));
          queuePostServiceActionRefresh(request.action);
          return;
        }
        resolve(result);
      }, error => {
        if (timedOut) {
          writeLog(lateServiceActionFailureLog(request.action, error));
          queuePostServiceActionRefresh(request.action);
          return;
        }
        reject(error);
      })
      .finally(() => window.clearTimeout(timeoutHandle));
  });
}

function serviceActionTimeoutWithLateCompletionLog(action: WatcherServiceAction, timeoutMs: number): string {
  return [
    serviceActionTimeoutLog(action, timeoutMs),
    'Пульт не отменил команду в службе.',
    'Если команда завершится позже, пульт покажет финальную квитанцию и обновит статус.',
  ].join('\n');
}

function lateServiceActionCompletionLog(action: WatcherServiceAction, result: WatcherServiceActionResult): string {
  return [
    `Позднее завершение после UI timeout: ${actionLabel(action)}`,
    'Финальная квитанция команды получена после локального ожидания.',
    serviceActionLog(result),
  ].join('\n');
}

function lateServiceActionFailureLog(action: WatcherServiceAction, error: Error | string | number | boolean | null | undefined): string {
  return [
    `Поздняя ошибка после UI timeout: ${actionLabel(action)}`,
    'Финальный ответ команды пришёл после локального ожидания.',
    errorMessage(error),
  ].join('\n');
}

function queuePostServiceActionRefresh(action: WatcherServiceAction): void {
  void runPostServiceActionRefresh()
    .catch(error => {
      console.warn(`post service action refresh failed after ${actionLabel(action)}`, error);
    });
}

function runPostServiceActionRefresh(): Promise<void> {
  const refreshPromise = refresh();
  return new Promise<void>((resolve, reject) => {
    const timeoutHandle = window.setTimeout(() => {
      reject(new Error(`Post service action refresh exceeded ${POST_SERVICE_ACTION_REFRESH_TIMEOUT_MS}ms`));
    }, POST_SERVICE_ACTION_REFRESH_TIMEOUT_MS);

    refreshPromise
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timeoutHandle));
  });
}

async function saveCurrentConfigPackage(): Promise<void> {
  const result = await window.watcherDesktop.projects.saveConfigPackage(currentProjectId());
  writeLog(result ? configSaveLog(result) : 'Скачивание отменено');
  if (result) await refresh();
}

async function selectProjectRootFromDialog(): Promise<void> {
  const root = await window.watcherDesktop.projects.selectRoot();
  if (!root) {
    writeLog('Выбор папки проекта отменён');
    return;
  }
  automaticSupportEnrollmentAttempts.clear();
  await saveRootProfile(root);
  await refresh();
}

async function removeSelectedProjectFromConsole(): Promise<void> {
  const project = selectedProject();
  if (!project) {
    writeLog('Проект для удаления из списка пульта не выбран');
    return;
  }
  const profiles = await window.watcherDesktop.projects.remove(project.id, project.root);
  automaticSupportEnrollmentAttempts.clear();
  await saveUiState({ ...uiState, lastProjectId: profiles.length ? '' : null, activeSection: 'start' });
  writeLog([
    `Проект убран из списка пульта: ${project.name}`,
    `Папка на диске не удалялась: ${project.root}`,
  ].join('\n'));
  await refresh();
}

async function importConfigFromDialog(): Promise<void> {
  const result = await window.watcherDesktop.projects.importConfig();
  if (!result) {
    writeLog('Импорт файла настройки MCP отменён');
    return;
  }
  automaticSupportEnrollmentAttempts.clear();
  await saveUiState({
    ...uiState,
    lastProjectId: result.profile?.id ?? uiState.lastProjectId,
    activeSection: 'start',
  });
  writeLog(importResultLog(result));
  await refresh();
}

async function goToSection(activeSection: DesktopSection): Promise<void> {
  await saveUiState({ ...uiState, activeSection });
  renderUiState();
}

async function refresh(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshInternal().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function refreshInternal(): Promise<void> {
  accessState = await safeAccessStatus();
  uiState = await safeUiState();
  renderShellAccess(accessState, { accountEl, appShellEl, authStatusEl, loginScreenEl });
  renderUiState();
  if (!accessState.signedIn) return;
  currentProjects = await safeProjects();
  renderProjectSelect(currentProjects, projectSelect, currentProjectId());
  await ensureSupportDeviceEnrollment();
  const [check, pack, modes] = await Promise.all([
    safeFullCheck(),
    safeConfigPackage(),
    safeModes(),
  ]);
  currentPackage = pack;
  currentModes = modes;
  activeModeId = resolveActiveModeId(currentModes, activeModeId);
  const visibleCheck = withCodexGateProgress(check, codexGateVerificationProjectId);
  currentConnectionCheck = visibleCheck;
  renderOverall(visibleCheck, overallStatusEl);
  renderConnectionCause(visibleCheck, connectionCauseEl);
  renderConnectionCheck(visibleCheck, checklistEl);
  currentServiceStatus = check.service;
  renderService(check.service, serviceStatusEl, serviceSummaryEl);
  setServiceActionState(serviceButtons, check.service);
  setServiceConfirmationHint(serviceButtons, pendingServiceAction);
  renderCurrentPackage();
  renderModes(currentModes, modesEl, activeModeId);
  scheduleAutomaticCodexGateVerification(check);
}

async function renderAppVersion(): Promise<void> {
  try {
    const version = await window.watcherDesktop.app.getVersion();
    appVersionEls.forEach(element => setText(element, `v${version}`));
  } catch (error) {
    const message = errorMessage(error);
    appVersionEls.forEach(element => setText(element, 'v?.?.?'));
    writeLog(`Версия пульта недоступна: ${message}`);
  }
}

function scheduleAutomaticCodexGateVerification(check: DesktopConnectionCheck): void {
  if (codexGateVerificationProjectId) return;
  if (!needsAutomaticCodexGateVerification(check)) return;
  const projectId = check.projectId ?? currentProjectId();
  const attemptKey = `${projectId}:${check.codexGates.message}`;
  if (automaticCodexGateRunning || automaticCodexGateAttempts.has(attemptKey)) return;
  automaticCodexGateAttempts.add(attemptKey);
  automaticCodexGateRunning = true;
  window.setTimeout(() => {
    void runAutomaticCodexGateVerification(projectId);
  }, 0);
}

function needsAutomaticCodexGateVerification(check: DesktopConnectionCheck): boolean {
  if (!accessState?.signedIn || check.codexGates.ready) return false;
  if (!check.projectId) return false;
  if (hasCodexGateFailure(check)) return false;
  return hasTrustedCodexProject(check) && !hasCodexBaseVerification(check);
}

function hasCodexBaseVerification(check: DesktopConnectionCheck): boolean {
  const evidence = check.codexGates.evidence;
  return isCurrentPassed(evidence.verification.codexTrust, check.codexGates.checkedAt)
    && isCurrentPassed(evidence.verification.codexRuntime, check.codexGates.checkedAt)
    && isCurrentPassed(evidence.commandRuns.codexHooks, check.codexGates.checkedAt)
    && isCurrentSmokeSatisfied(evidence.verification.smoke, check.codexGates.checkedAt)
    && isCurrentPassed(evidence.verification.rollback, check.codexGates.checkedAt);
}

function hasCodexGateFailure(check: DesktopConnectionCheck): boolean {
  const evidence = check.codexGates.evidence;
  return [
    evidence.verification.codexTrust,
    evidence.verification.codexRuntime,
    evidence.commandRuns.codexHooks,
    evidence.verification.desktopBootstrap,
    evidence.verification.hookPersistence,
    evidence.verification.runtimeContext,
    evidence.verification.smoke,
    evidence.verification.rollback,
  ].some(item => item?.available === true && item.passed === false);
}

function hasTrustedCodexProject(check: DesktopConnectionCheck): boolean {
  const trust = check.codexGates.evidence.verification.codexTrust;
  return trust === undefined || isCurrentPassed(trust, check.codexGates.checkedAt);
}

function isPassed(value: DesktopCodexGateRunEvidence | undefined): boolean {
  return value?.available === true && value.passed === true;
}

function isCurrentPassed(value: DesktopCodexGateRunEvidence | undefined, checkedAt: string): boolean {
  return isPassed(value) && !isStale(value, checkedAt);
}

function isCurrentSmokeSatisfied(value: DesktopCodexGateRunEvidence | undefined, checkedAt: string): boolean {
  return isCurrentPassed(value, checkedAt) || (value?.available === false && !isStale(value, checkedAt));
}

function isStale(value: DesktopCodexGateRunEvidence | undefined, checkedAt: string): boolean {
  if (!value || value.checkedAt === undefined || value.staleAfterMs === undefined) return false;
  const valueTime = Date.parse(value.checkedAt);
  const referenceTime = Date.parse(checkedAt);
  if (!Number.isFinite(valueTime) || !Number.isFinite(referenceTime)) return true;
  return referenceTime - valueTime > value.staleAfterMs;
}

async function ensureSupportDeviceEnrollment(): Promise<void> {
  if (!accessState?.signedIn || automaticSupportEnrollmentRunning) return;
  const projectId = currentProjectId();
  const key = supportEnrollmentAttemptKey(projectId);
  const lastAttemptAt = automaticSupportEnrollmentAttempts.get(key) ?? 0;
  if (Date.now() - lastAttemptAt < supportEnrollmentRetryMs) return;
  automaticSupportEnrollmentRunning = true;
  automaticSupportEnrollmentAttempts.set(key, Date.now());
  try {
    const status = await window.watcherDesktop.support.status();
    if (status.enrolled) return;
    writeLog(formatSupportEnrollmentLog(status, null, projectId));
    const enrollment = await window.watcherDesktop.support.enroll(projectId);
    writeLog(formatSupportEnrollmentLog(enrollment.status, enrollment, projectId));
    if (enrollment.enrolled) automaticSupportEnrollmentAttempts.delete(key);
  } catch (error) {
    writeLog(`Support-device auto enrollment не завершён: ${errorMessage(error)}`);
  } finally {
    automaticSupportEnrollmentRunning = false;
  }
}

function supportEnrollmentAttemptKey(projectId: string): string {
  return `${accessState?.email ?? 'local'}:${projectId}`;
}

async function runAutomaticCodexGateVerification(projectId: string): Promise<void> {
  codexGateVerificationProjectId = projectId;
  writeLog('Автоматически настраиваем Codex: CLI, persistent-verifier, Runtime Context hooks, smoke и rollback...');
  await refresh();
  try {
    const result = await window.watcherDesktop.codexGates.verify(projectId);
    writeLog(formatCodexGateDiagnostics(result, projectId));
    await refresh();
  } catch (error) {
    writeLog(`Автонастройка Codex не завершилась: ${errorMessage(error)}`);
    for (const key of [...automaticCodexGateAttempts]) {
      if (key.startsWith(`${projectId}:`)) automaticCodexGateAttempts.delete(key);
    }
  } finally {
    automaticCodexGateRunning = false;
    codexGateVerificationProjectId = null;
    await refresh();
  }
}

async function safeAccessStatus(): Promise<DesktopAccessState> {
  try {
    return await window.watcherDesktop.access.status();
  } catch (error) {
    setText(authStatusEl, errorMessage(error));
    throw error;
  }
}

async function safeUiState(): Promise<DesktopUiState> {
  try {
    return await window.watcherDesktop.ui.loadState();
  } catch {
    return defaultUiState();
  }
}

async function safeProjects(): Promise<readonly SavedProjectProfile[]> {
  try {
    return await window.watcherDesktop.projects.list();
  } catch (error) {
    writeLog(errorMessage(error));
    return [];
  }
}

async function safeFullCheck(): Promise<DesktopConnectionCheck> {
  try {
    return await window.watcherDesktop.service.fullCheck(currentProjectId());
  } catch (error) {
    return fallbackCheck(errorMessage(error));
  }
}

async function safeConfigPackage(): Promise<DesktopConfigPackage | null> {
  try {
    return await window.watcherDesktop.projects.buildConfigPackage(currentProjectId());
  } catch (error) {
    writeLog(errorMessage(error));
    return null;
  }
}

async function safeModes() {
  try {
    return await window.watcherDesktop.modes.list(currentProjectId());
  } catch (error) {
    writeLog(errorMessage(error));
    return [];
  }
}

async function saveUiState(next: DesktopUiState): Promise<void> {
  uiState = await window.watcherDesktop.ui.saveState(next);
}

async function saveRootProfile(root: string): Promise<void> {
  const draft = draftFromRoot(root);
  const saved = await window.watcherDesktop.projects.save(draft);
  await saveUiState({ ...uiState, lastProjectId: saved.id, activeSection: 'start' });
}

function renderUiState(): void {
  applyUiState(uiState, sections, navButtons);
  bottomConsoleEl?.toggleAttribute('data-collapsed', !uiState.consoleOpen);
  renderThemeToggle();
  renderConsoleToggle();
}

function setActiveMode(modeId: string): void {
  activeModeId = resolveActiveModeId(currentModes, modeId);
  renderModes(currentModes, modesEl, activeModeId);
}

function toggleCustomSelect(toggle: HTMLButtonElement): void {
  const root = toggle.closest<HTMLElement>('[data-custom-select]');
  const menu = root?.querySelector<HTMLElement>('[data-custom-select-menu]');
  if (!root || !menu) return;
  const willOpen = menu.hidden;
  closeCustomSelects(root);
  menu.hidden = !willOpen;
  toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  root.toggleAttribute('data-open', willOpen);
}

function closeCustomSelects(exceptRoot: HTMLElement | null = null): void {
  document.querySelectorAll<HTMLElement>('[data-custom-select]').forEach(root => {
    if (exceptRoot && root === exceptRoot) return;
    root.removeAttribute('data-open');
    root.querySelector<HTMLElement>('[data-custom-select-menu]')?.setAttribute('hidden', '');
    root.querySelector<HTMLButtonElement>('[data-custom-select-toggle]')?.setAttribute('aria-expanded', 'false');
  });
}

function selectProjectOption(option: HTMLButtonElement): void {
  const value = option.dataset.projectOption;
  if (!value || !projectSelect) return;
  projectSelect.value = value;
  closeCustomSelects();
  projectSelect.dispatchEvent(new Event('change', { bubbles: true }));
}

function selectModeOption(option: HTMLButtonElement): void {
  const value = option.dataset.modeOption;
  const root = option.closest<HTMLElement>('[data-mode-picker]');
  const select = root?.querySelector<HTMLSelectElement>('[data-mode-select]');
  if (!value || !select) return;
  select.value = value;
  closeCustomSelects();
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function stepActiveMode(direction: 'prev' | 'next'): void {
  if (currentModes.length === 0) return;
  const currentId = resolveActiveModeId(currentModes, activeModeId);
  const currentIndex = Math.max(0, currentModes.findIndex(mode => mode.id === currentId));
  const offset = direction === 'next' ? 1 : -1;
  const nextIndex = (currentIndex + offset + currentModes.length) % currentModes.length;
  setActiveMode(currentModes[nextIndex]?.id ?? currentId);
}

function resolveActiveModeId(modes: readonly DesktopModeSummary[], modeId: string | null): string | null {
  if (modes.length === 0) return null;
  return modes.some(mode => mode.id === modeId) ? modeId : modes[0]?.id ?? null;
}

function renderThemeToggle(): void {
  const darkTarget = uiState.theme === 'light';
  const label = darkTarget ? 'Включить тёмную тему' : 'Включить светлую тему';
  setIconButton(toggleThemeButton, darkTarget ? moonIcon() : sunIcon(), label);
}

function renderConsoleToggle(): void {
  const label = uiState.consoleOpen ? 'Скрыть логи' : 'Показать логи';
  setIconButton(consoleToggleButton, uiState.consoleOpen ? chevronDownIcon() : chevronUpIcon(), label);
}

function setIconButton(button: HTMLButtonElement | null, icon: string, label: string): void {
  if (!button) return;
  button.innerHTML = icon;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.dataset.tooltip = label;
}

function hydrateStaticIcons(): void {
  document.querySelectorAll<HTMLElement>('[data-icon]').forEach(element => {
    if (!isDesktopIconName(element.dataset.icon)) return;
    element.innerHTML = iconSvg(element.dataset.icon);
  });
}

function showTooltipFromTarget(target: EventTarget | null): void {
  if (!floatingTooltipEl || !(target instanceof Element)) return;
  const anchor = target.closest<HTMLElement>('[data-tooltip]');
  const text = anchor?.dataset.tooltip?.trim();
  if (!anchor || !text || anchor.matches(':disabled')) {
    hideTooltip();
    return;
  }
  setText(floatingTooltipEl, text);
  floatingTooltipEl.hidden = false;
  floatingTooltipEl.dataset.visible = 'true';
  positionTooltip(anchor, floatingTooltipEl);
}

function hideTooltip(): void {
  if (!floatingTooltipEl) return;
  floatingTooltipEl.removeAttribute('data-visible');
  floatingTooltipEl.hidden = true;
}

function positionTooltip(anchor: HTMLElement, tooltip: HTMLElement): void {
  tooltip.style.left = '0';
  tooltip.style.top = '0';
  const anchorRect = anchor.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const margin = 8;
  const left = clamp(
    anchorRect.left + (anchorRect.width - tooltipRect.width) / 2,
    margin,
    window.innerWidth - tooltipRect.width - margin,
  );
  const top = anchorRect.top > tooltipRect.height + margin
    ? anchorRect.top - tooltipRect.height - margin
    : anchorRect.bottom + margin;
  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(Math.max(margin, top))}px`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function sunIcon(): string {
  return iconSvg('sun');
}

function moonIcon(): string {
  return iconSvg('moon');
}

function chevronUpIcon(): string {
  return iconSvg('chevron-up');
}

function chevronDownIcon(): string {
  return iconSvg('chevron-down');
}

async function openServiceLogs(): Promise<void> {
  await saveUiState({ ...uiState, consoleOpen: true });
  renderUiState();
}

function renderCurrentPackage(): void {
  renderConfigPackage(
    currentPackage,
    { configFileEl: null, configJsonEl: null, configStatusEl: null, keyPreviewEl: null, promptEl },
    uiState.keyVisible,
    connectionServerVerified(currentConnectionCheck),
  );
}

function currentProjectId(): string {
  if (projectSelect?.value) return projectSelect.value;
  if (uiState.lastProjectId !== null) return uiState.lastProjectId;
  return currentProjects[0]?.id || '';
}

function selectedProject(): SavedProjectProfile | undefined {
  const projectId = currentProjectId();
  return projectId ? currentProjects.find(project => project.id === projectId) : undefined;
}

function draftFromRoot(root: string): ProjectDraft {
  const name = root.split(/[\\/]/).filter(Boolean).at(-1) ?? 'MCP Project';
  const id = slug(name);
  return {
    id,
    name,
    root,
    indexId: `idx-${id}`,
    serverUrl: accessState?.config.serverUrl ?? selectedProject()?.serverUrl ?? '',
    tokenEnv: accessState?.config.tokenEnv ?? selectedProject()?.tokenEnv ?? 'MCP_BEARER_TOKEN',
  };
}

function fallbackCheck(message: string): DesktopConnectionCheck {
  const diagnostics = fallbackDiagnostics(message);
  return {
    overall: 'error',
    message: 'Проверка подключения не завершена',
    projectId: null,
    checkedAt: new Date().toISOString(),
    nodes: [{ id: 'runtime', label: 'Проверка подключения', status: 'error', detail: message, action: 'open_logs', actionLabel: 'Показать логи' }],
    codexGates: {
      ready: false,
      message: 'Codex gates не проверены: общий full check не завершился.',
      checkedAt: new Date().toISOString(),
      evidence: { commandRuns: {}, verification: {} },
    },
    service: fallbackStatus(message),
    diagnostics,
  };
}

function fallbackDiagnostics(message: string): DiagnosticsPreview {
  return {
    blocked: true,
    requiresSecretConfirmation: true,
    readiness: 'deny',
    findings: [message],
    included: [],
    secretWarnings: [],
    checks: [],
  };
}

function fallbackStatus(message: string): WatcherServiceStatus {
  return fallbackServiceStatus(message);
}

async function copyText(value: string): Promise<void> {
  if (!value) throw new Error('Нечего копировать');
  await window.watcherDesktop.clipboard.writeText(value);
}

function writeLog(value: string): void {
  setText(serviceOutputEl, redactDesktopLogText(value));
  if (!uiState.consoleOpen) void saveUiState({ ...uiState, consoleOpen: true }).then(() => renderUiState());
}

function connectionCheckLog(check: DesktopConnectionCheck | null): string {
  if (!check) return 'Проверка контура не вернула данных. Повторите проверку или откройте диагностику службы.';
  const lines = [
    'Проверка контура MCP завершена',
    `Проект: ${check.projectId ?? currentProjectId() ?? 'не определён'}`,
    `Статус: ${overallLogLabel(check.overall)}`,
    `Сообщение: ${check.message}`,
    `Проверено: ${check.checkedAt}`,
    '',
    'Маршрут проверки:',
    ...check.nodes.map(node => `${checkNodeLogLabel(node.status)} ${node.label}: ${node.detail}`),
  ];
  const serviceText = serviceStatusEl?.textContent?.trim();
  if (serviceText) lines.push('', 'Статус watcher:', serviceText);
  return lines.join('\n');
}

function overallLogLabel(value: DesktopConnectionCheck['overall']): string {
  if (value === 'ready') return 'готов';
  if (value === 'error') return 'ошибка';
  return 'нужно действие';
}

function checkNodeLogLabel(value: DesktopConnectionCheck['nodes'][number]['status']): string {
  if (value === 'active') return '[готово]';
  if (value === 'waiting') return '[ожидает]';
  return '[нет]';
}

function startServiceActionProgress(action: WatcherServiceAction): () => void {
  const startedAt = Date.now();
  let syncInFlight = false;
  let cancelled = false;
  const renderProgress = (): void => {
    if (cancelled) return;
    setText(serviceOutputEl, serviceActionProgressLines(action, Date.now() - startedAt, undefined, currentServiceStatus).join('\n'));
  };
  const syncServiceContour = async (): Promise<void> => {
    if (syncInFlight || cancelled) return;
    syncInFlight = true;
    try {
      const check = await safeFullCheck();
      if (cancelled) return;
      const visibleCheck = withCodexGateProgress(check, codexGateVerificationProjectId);
      currentConnectionCheck = visibleCheck;
      currentServiceStatus = visibleCheck.service;
      renderOverall(visibleCheck, overallStatusEl);
      renderConnectionCause(visibleCheck, connectionCauseEl);
      renderConnectionCheck(visibleCheck, checklistEl);
      renderService(visibleCheck.service, serviceStatusEl, serviceSummaryEl);
      setServiceActionState(serviceButtons, visibleCheck.service);
      setServiceConfirmationHint(serviceButtons, pendingServiceAction);
    } catch (error) {
      console.warn('service progress sync failed', error);
    } finally {
      syncInFlight = false;
    }
  };
  writeLog(serviceActionProgressLines(action, 0, undefined, currentServiceStatus).join('\n'));
  const timer = window.setInterval(renderProgress, 1000);
  const syncTimer = window.setInterval(() => {
    void syncServiceContour().then(renderProgress);
  }, 2500);
  void syncServiceContour().then(renderProgress);
  return () => {
    cancelled = true;
    window.clearInterval(timer);
    window.clearInterval(syncTimer);
  };
}

async function serviceAiLogsText(): Promise<string> {
  const aiStatus = redactDesktopServiceStatus(currentServiceStatus);
  const statusText = serviceStatusEl?.textContent?.trim() ?? '';
  const commandText = tailText(
    serviceOutputEl?.textContent?.trim() ?? '',
    SERVICE_AI_COMMAND_TEXT_LIMIT,
    '[TRUNCATED_COMMAND_OUTPUT_FOR_AI_COPY]',
  );
  const expandedLogsText = await serviceAiExpandedLogsText(aiStatus);
  const rawText = [statusText, commandText, expandedLogsText].filter(Boolean).join('\n\n');
  const redaction = redactDesktopLogTextWithReceipt(rawText, 'ai');
  const redactedText = redaction.text;
  const safeText = tailText(
    redactedText,
    SERVICE_AI_CONTEXT_TEXT_LIMIT,
    '[TRUNCATED_BY_AI_CONTEXT_LIMIT]',
  );
  const diagnostics = classifyDesktopAiDiagnostics(safeText, aiStatus);
  const nextActions = diagnostics.map(item => item.nextAction);
  const requiredNext = desktopRequiredNext(nextActions, aiStatus);
  const railMap = desktopRailMap(aiStatus, diagnostics, expandedLogsText, requiredNext);
  return JSON.stringify({
    schemaVersion: 'watcher-ai-context/v1',
    generatedAt: new Date().toISOString(),
    project: aiStatus?.projectId ?? currentProjectId(),
    root: aiStatus?.root ?? selectedProject()?.root ?? null,
    summary: diagnostics[0]?.message ?? serviceSummaryForAi(aiStatus),
    diagnostics,
    evidence_refs: serviceEvidenceRefs(aiStatus),
    next_actions: nextActions,
    required_next: requiredNext,
    rail_map: railMap,
    expanded_log_chunks: expandedLogsText ? redactDesktopLogText(expandedLogsText) : null,
    machine_snapshot: aiStatus ? {
      installed: aiStatus.installed,
      running: aiStatus.running,
      health: aiStatus.health,
      pid: aiStatus.pid,
      lastSyncAt: aiStatus.lastSyncAt,
      lastError: aiStatus.lastError,
    } : null,
    log_transport: aiStatus?.logs?.transport ?? null,
    rawTail: safeText,
    redacted: redaction.redacted,
    redaction: {
      profile: redaction.profile,
      replacement_count: redaction.replacementCount,
    },
    truncated: safeText !== redactedText,
  }, null, 2);
}

async function serviceAiExpandedLogsText(status: WatcherServiceStatus | null): Promise<string> {
  const projectId = status?.projectId ?? currentProjectId();
  const streams = status?.logs?.transport.streams ?? [];
  const sections = await Promise.all(streams.map(stream => serviceAiStreamText(projectId, stream)));
  return sections.filter(Boolean).join('\n\n');
}

async function serviceAiStreamText(projectId: string, stream: WatcherServiceLogStream): Promise<string | null> {
  const initialCursor = stream.tailCursor ?? stream.firstCursor;
  if (!initialCursor) return null;
  const chunks: string[] = [];
  let cursor: string | null = initialCursor;
  let cursorError = false;
  for (let index = 0; cursor && index < SERVICE_AI_LOG_CHUNK_LIMIT; index += 1) {
    const chunk = await window.watcherDesktop.service.logChunk(projectId, cursor);
    if (!chunk) {
      cursorError = true;
      break;
    }
    chunks.push(chunk.text);
    cursor = chunk.nextCursor;
    if (chunk.complete) break;
  }
  if (!chunks.length && cursorError) return `Лог ${stream.label} (${stream.id}):\n[LOG_CURSOR_UNAVAILABLE]`;
  if (!chunks.length) return null;
  const suffix = cursorError ? '\n[LOG_CURSOR_UNAVAILABLE]' : cursor ? '\n[TRUNCATED_BY_AI_COPY_LIMIT]' : '';
  const prefix = stream.tail.truncated ? '[OLDER_LOG_BYTES_TRUNCATED]\n' : '';
  return `Лог ${stream.label} (${stream.id}):\n${prefix}${chunks.join('')}${suffix}`;
}

function tailText(value: string, limit: number, marker: string): string {
  if (value.length <= limit) return value;
  return `${marker}\n${value.slice(value.length - limit)}`;
}

function classifyDesktopAiDiagnostics(text: string, status: WatcherServiceStatus | null): readonly DesktopAiDiagnostic[] {
  const diagnostics: DesktopAiDiagnostic[] = [];
  const metadataMismatch = serviceMetadataMismatch(status);
  if (metadataMismatch) diagnostics.push({
    code: 'WATCHER_SERVICE_METADATA_ROOT_MISMATCH',
    severity: 'error' as const,
    message: metadataMismatch,
    cause: 'Windows Service metadata points to another project root or contains corrupted path metadata.',
    impact: 'Watcher exits before the selected project can be indexed.',
    nextAction: 'Нажми «Починить службу» для выбранного проекта, затем повтори проверку.',
  });
  if (status?.installed && !status.running) diagnostics.push({
    code: 'WATCHER_SERVICE_STOPPED',
    severity: 'error' as const,
    message: status.lastError ?? 'Watcher service stopped',
    cause: 'Windows service is installed but not running.',
    impact: 'MCP index will not refresh until watcher starts.',
    nextAction: 'Запусти watcher service и повтори проверку.',
  });
  if (/Watcher lease rejected:\s*Unauthorized|lease rejected:\s*Unauthorized/i.test(text)) diagnostics.push({
    code: 'WATCHER_UNAUTHORIZED',
    severity: 'error' as const,
    message: 'Watcher lease rejected: Unauthorized',
    cause: 'Bearer token is absent, expired, or bound to another project/server.',
    impact: 'Server is reachable, but watcher cannot acquire lease.',
    nextAction: 'Обнови ключ в пульте и проверь project/server в .brain/config.json.',
  });
  if (/better-sqlite3|node-gyp|No prebuilt binaries found|Visual Studio installation/i.test(text)) diagnostics.push({
    code: 'WATCHER_NATIVE_RUNTIME_BUILD_FAILED',
    severity: 'error' as const,
    message: 'Native runtime dependency failed to install.',
    cause: 'Node runtime has no prebuilt better-sqlite3 binary and node-gyp cannot compile it.',
    impact: 'Service exits before watcher runtime starts.',
    nextAction: 'Обнови watcher runtime или используй Node LTS / Visual Studio Build Tools C++.',
  });
  if (/spawnSync\s+npm\.cmd\s+EINVAL|spawn\s+npm\.cmd\s+EINVAL/i.test(text)) diagnostics.push({
    code: 'WATCHER_NPM_SPAWN_EINVAL',
    severity: 'error' as const,
    message: 'npm.cmd не запустился из service runtime installer.',
    cause: 'Windows spawn/cmd invocation failed before npm produced a useful log.',
    impact: 'Runtime package is not installed, watcher service exits after start.',
    nextAction: 'Обнови watcher до версии с cmd-wrapper installer и повтори «Починить службу».',
  });
  if (/service_runtime_missing|runtime-entry\.(?:cjs|js).+not found|Cannot find module.*runtime-entry/i.test(text)) diagnostics.push({
    code: 'WATCHER_RUNTIME_ENTRY_MISSING',
    severity: 'error' as const,
    message: 'Локальный runtime-entry watcher не найден.',
    cause: 'Service launcher points to local runtime, but runtime package was not installed or was removed.',
    impact: 'Windows service starts PowerShell and immediately exits.',
    nextAction: 'Нажми «Починить службу»: пульт переустановит runtime и перепишет launcher.',
  });
  if (/"?npx\.cmd"?/i.test(text) && /service install|watcher\.install|not recognized|не\s+является|��|�/i.test(text)) diagnostics.push({
    code: 'WATCHER_NPX_COMMAND_MISSING',
    severity: 'error' as const,
    message: 'npx.cmd не найден при установке watcher-службы.',
    cause: 'Desktop bootstrap attempted to run the watcher installer through npx.cmd before the local service runtime existed.',
    impact: 'Windows service is not installed, so wrapper/out/err logs may be absent.',
    nextAction: 'Обнови пульт до версии с node+npx-cli fallback и повтори «Установить службу» или «Починить службу».',
  });
  if (/"?C:\\Program"?\s+.*(?:not recognized|не\s+является|��|�)/i.test(text)) diagnostics.push({
    code: 'WATCHER_COMMAND_PATH_QUOTING',
    severity: 'error' as const,
    message: 'Windows разрезал путь команды на C:\\Program.',
    cause: 'A .cmd or executable path with spaces was passed to cmd.exe without the required Windows quoting contract.',
    impact: 'Service install/repair exits before WinSW can create useful wrapper logs.',
    nextAction: 'Обнови пульт до версии с .cmd quoting fix и повтори «Установить службу» или «Починить службу».',
  });
  if (/launcher_uses_npx_runner|npx(?:\.cmd)?|github:horggorg88-pixel\/project-brain-watcher#v/i.test(text)) diagnostics.push({
    code: 'WATCHER_LEGACY_NPX_LAUNCHER',
    severity: 'warn' as const,
    message: 'Service launcher still uses npx/npm runner.',
    cause: 'Old launcher path is still registered or launch-watcher.ps1 was not refreshed.',
    impact: 'Service can fail under SYSTEM profile, wrong npm cache, or native dependency rebuild.',
    nextAction: 'Нажми «Починить службу», чтобы launcher перешёл на локальный runtime package.',
  });
  if (/npm warn cleanup|EPERM:\s*operation not permitted,\s*rmdir/i.test(text)) diagnostics.push({
    code: 'WATCHER_NPM_CACHE_CLEANUP_EPERM',
    severity: 'warn' as const,
    message: 'npm не смог очистить часть cache/runtime директории.',
    cause: 'Windows locked files inside npm cache after failed install or service process.',
    impact: 'Usually not the root cause, but can hide the real npm install failure above it.',
    nextAction: 'Смотри runtime-install.log выше; если install повторяется, перезапусти пульт от администратора и повтори repair.',
  });
  return diagnostics;
}

function desktopRequiredNext(nextActions: readonly string[], status: WatcherServiceStatus | null): string {
  if (nextActions[0]) return nextActions[0];
  if (!status) return 'Обнови статус службы watcher и повтори диагностику.';
  if (!status.installed) return 'Установи watcher service для выбранного проекта.';
  if (serviceMetadataMismatch(status)) return 'Нажми «Починить службу» для выбранного проекта, затем повтори проверку.';
  if (!status.running) return 'Запусти watcher service и повтори проверку.';
  if (status.health !== 'healthy') return 'Повтори диагностику watcher и проверь свежий лог.';
  return 'Блокеров в локальном статусе службы не найдено.';
}

function desktopRailMap(status: WatcherServiceStatus | null, diagnostics: readonly DesktopAiDiagnostic[], expandedLogsText: string, requiredNext: string): DesktopAiRailMap {
  return {
    version: 'watcher-rail-map/v1',
    required_next: requiredNext,
    rails: [
      {
        id: 'service.metadata',
        label: 'Windows service metadata',
        status: serviceMetadataMismatch(status) ? 'blocked' : status?.installed ? 'ready' : 'blocked',
        evidence: serviceMetadataMismatch(status) ?? (status?.installed ? 'service installed' : 'service not installed'),
      },
      { id: 'service.process', label: 'Windows service process', status: status?.running ? 'ready' : 'blocked', evidence: status?.running ? `pid=${status.pid ?? 'unknown'}` : status?.lastError ?? 'service stopped' },
      { id: 'runtime.health', label: 'Watcher health', status: status?.health === 'healthy' ? 'ready' : status ? 'waiting' : 'blocked', evidence: status?.health ?? 'status missing' },
      { id: 'logs.evidence', label: 'Expanded log evidence', status: expandedLogsText ? 'ready' : 'waiting', evidence: expandedLogsText ? 'log chunks included' : 'no expanded chunks' },
      { id: 'diagnostics.classifier', label: 'Diagnostic classifier', status: diagnostics.some(item => item.severity === 'error') ? 'blocked' : 'ready', evidence: diagnostics.length ? diagnostics.map(item => item.code).join(', ') : 'no matched blockers' },
      { id: 'ai.required-next', label: 'AI next action', status: desktopNextActionRailStatus(diagnostics, requiredNext), evidence: requiredNext },
    ],
    machine_contract: {
      read_order: ['summary', 'required_next', 'diagnostics', 'rail_map', 'evidence_refs', 'expanded_log_chunks'],
      completion_rule: 'follow required_next until diagnostics are empty and service rails are ready',
      redaction: 'required',
      chunking: 'cursor-or-tail',
      output_profiles: {
        human: {
          surface: 'desktop-status/logs-panel',
          purpose: 'operator-readable diagnosis',
        },
        machine: {
          surface: 'desktop-ipc-json',
          schema: 'watcher-service-status/v1',
        },
        ai: {
          surface: 'watcher-ai-context',
          schema: 'watcher-ai-context/v1',
        },
      },
      artifact_policy: {
        log_text: 'tail-bounded-redacted',
        copy_target: 'ai_context_bundle',
      },
    },
  };
}

function serviceMetadataMismatch(status: WatcherServiceStatus | null): string | null {
  const message = status?.lastError ?? '';
  const match = message.match(/Windows Service metadata указывает на другой root:[^\n]+/i);
  return match?.[0] ?? null;
}

function desktopNextActionRailStatus(diagnostics: readonly DesktopAiDiagnostic[], requiredNext: string): DesktopAiRailNode['status'] {
  if (diagnostics.some(item => item.severity === 'error')) return 'blocked';
  return /блокеров.+не найдено/i.test(requiredNext) ? 'ready' : 'waiting';
}

function serviceSummaryForAi(status: WatcherServiceStatus | null): string {
  if (!status) return 'Service status is not loaded.';
  if (status.running && status.health === 'healthy') return 'Watcher service is healthy.';
  return status.lastError ?? `Watcher service health: ${status.health}`;
}

function serviceEvidenceRefs(status: WatcherServiceStatus | null): readonly { readonly kind: string; readonly label: string; readonly path: string | null }[] {
  const logs = status?.logs;
  if (!logs) return [];
  return [
    { kind: 'log', label: 'stdout', path: logs.outPath },
    { kind: 'log', label: 'stderr', path: logs.errPath },
    { kind: 'log', label: 'wrapper', path: logs.wrapperPath },
    { kind: 'log', label: 'runtime_install', path: logs.runtimeInstallPath },
  ];
}

function serviceActionLog(result: WatcherServiceActionResult): string {
  const output = result.output.trim() || 'Команда завершилась без вывода';
  const commandStatus = result.commandStatus ? serviceCommandStatusLine(result.commandStatus) : null;
  const receipt = formatCommandReceipt(result.receipt);
  const primaryCause = formatServicePrimaryCause(result.primaryCause ?? result.progress?.primaryCause ?? null);
  const progress = formatServiceProgress(result.receipt, result.progress);
  const lines = [
    `${decisionLabel(result.policy.decision)}: код=${result.exitCode ?? 'нет'}`,
    `Проект: ${result.status.projectId ?? currentProjectId()}`,
    `Папка: ${result.status.root ?? selectedProject()?.root ?? 'не определена'}`,
    receipt,
    primaryCause,
    progress,
    commandStatus,
    output,
  ].filter((line): line is string => Boolean(line));
  if (result.status.lastError && !output.includes(result.status.lastError)) {
    lines.push(`Статус службы: ${result.status.lastError}`);
  }
  const logs = serviceLogSummary(result.status.logs);
  if (logs) lines.push('', logs);
  return lines.join('\n');
}

function formatCommandReceipt(receipt: DesktopCommandReceipt | undefined): string | null {
  if (!receipt) return null;
  const diagnostic = receipt.diagnostic ? `diagnostic=${receipt.diagnostic.code}` : 'diagnostic=none';
  const cursor = receipt.logCursor ? `logCursor=${receipt.logCursor}` : 'logCursor=none';
  return [
    'Квитанция команды:',
    `id=${receipt.receiptId}`,
    `run=${receipt.runId}`,
    `command=${receipt.commandId}`,
    `status=${receipt.status}; ack=${receipt.ackState}; ${diagnostic}; ${cursor}`,
  ].join('\n');
}

function formatServicePrimaryCause(cause: WatcherServicePrimaryCause | null): string | null {
  if (!cause) return null;
  return [
    'Главная причина:',
    `${cause.title} (${cause.code})`,
    `Деталь: ${cause.detail}`,
    `Что сделать: ${cause.nextAction}`,
  ].join('\n');
}

function formatServiceProgress(
  receipt: DesktopCommandReceipt | undefined,
  progress: WatcherServiceActionProgress | undefined,
): string | null {
  if (receipt) {
    return [
      'Прогресс операции:',
      `Итог: ${progress?.summary ?? commandReceiptSummary(receipt)}`,
      ...receipt.steps.map(step => `${progressStatusLabel(step.status)} ${step.label}: ${step.detail}`),
    ].join('\n');
  }
  if (!progress) return null;
  return [
    'Прогресс операции:',
    `Итог: ${progress.summary}`,
    ...progress.steps.map(step => `${progressStatusLabel(step.status)} ${step.label}: ${step.detail}`),
  ].join('\n');
}

function commandReceiptSummary(receipt: DesktopCommandReceipt): string {
  if (receipt.diagnostic) return receipt.diagnostic.title;
  if (receipt.status === 'passed') return 'Команда завершена';
  if (receipt.status === 'running') return 'Команда выполняется';
  return `Статус команды: ${receipt.status}`;
}

function progressStatusLabel(status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped'): string {
  const labels = {
    pending: '[ожидает]',
    running: '[идёт]',
    passed: '[готово]',
    failed: '[ошибка]',
    skipped: '[пропуск]',
  };
  return labels[status];
}

function serviceLogSummary(logs: WatcherServiceLogTail | null): string | null {
  if (!logs) return null;
  const sections = [
    logSummarySection('Лог работы watcher', logs.out),
    logSummarySection('Ошибки watcher', logs.err),
    logSummarySection('Лог Windows-службы', logs.wrapper),
    logSummarySection('Лог установки runtime watcher', logs.runtimeInstall),
  ].filter((line): line is string => line !== null);
  return sections.length ? ['Последние логи:', ...sections].join('\n') : 'Последние логи: файлов логов пока нет';
}

function logSummarySection(title: string, value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? `${title}:\n${trimmed}` : null;
}

function importResultLog(result: ProjectImportResult): string {
  const warnings = result.warnings.length ? `\n${result.warnings.join('\n')}` : '';
  if (!result.profile) return `Личный MCP-доступ импортирован${warnings}`;
  return `Файл настройки MCP импортирован: ${result.profile.name}${warnings}`;
}

function configSaveLog(result: DesktopConfigSaveResult): string {
  return [
    `Файл настройки MCP сохранён: ${result.packagePath}`,
    `Папка Brain-конфигов обновлена: ${result.brainDir}`,
    `.brain/config.json: ${result.brainConfigPath}`,
    `.brain/mcp.json с bearer: ${result.brainMcpPath}`,
  ].join('\n');
}

function checkActionFrom(value: string | undefined): DesktopCheckAction | null {
  const actions: readonly DesktopCheckAction[] = [
    'none',
    'select_project',
    'import_config',
    'download_config',
    'install_service',
    'start_service',
    'open_logs',
    'verify_codex_gates',
    'verify',
  ];
  return typeof value === 'string' && actions.includes(value as DesktopCheckAction)
    ? value as DesktopCheckAction
    : null;
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp-project';
}

function defaultUiState(): DesktopUiState {
  return {
    activeSection: 'start',
    theme: 'light',
    consoleOpen: false,
    lastProjectId: null,
    keyVisible: false,
  };
}
