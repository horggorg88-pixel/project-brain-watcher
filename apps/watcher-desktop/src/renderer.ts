import type {
  DesktopAccessState,
  DesktopCheckAction,
  DesktopConfigPackage,
  DesktopConfigSaveResult,
  DesktopConnectionCheck,
  DesktopSection,
  DesktopUiState,
  DiagnosticsPreview,
  McpDiffPreview,
  ProjectDraft,
  ProjectImportResult,
  SavedProjectProfile,
  WatcherServiceAction,
  WatcherServiceActionResult,
  WatcherServiceStatus,
} from './contracts.js';
import {
  applyUiState,
  errorMessage,
  fallbackStatus as fallbackServiceStatus,
  hydrateProjectForm,
  renderConfigPackage,
  renderConnectionCheck,
  renderDiagnostics,
  renderDiff,
  renderModes,
  renderOverall,
  renderProjectSelect,
  renderProjects,
  renderService,
  renderShellAccess,
  sectionFrom,
  setText,
} from './renderer-view.js';
import { actionLabel, decisionLabel, isServiceAction, setServiceBusy } from './renderer-service-ui.js';
import {
  resolveServiceActionConfirmation,
  setServiceConfirmationHint,
  type PendingServiceActionConfirmation,
} from './renderer-service-ui.js';

declare global {
  interface Window {
    readonly watcherDesktop: import('./contracts.js').WatcherDesktopApi;
  }
}

const authForm = document.querySelector<HTMLFormElement>('[data-auth-form]');
const projectForm = document.querySelector<HTMLFormElement>('[data-project-form]');
const authStatusEl = document.querySelector<HTMLElement>('[data-auth-status]');
const accountEl = document.querySelector<HTMLElement>('[data-profile-card]');
const appShellEl = document.querySelector<HTMLElement>('[data-app-shell]');
const loginScreenEl = document.querySelector<HTMLElement>('[data-login-screen]');
const navButtons = document.querySelectorAll<HTMLButtonElement>('[data-nav-section]');
const sections = document.querySelectorAll<HTMLElement>('[data-section]');
const projectSelect = document.querySelector<HTMLSelectElement>('[data-project-select]');
const selectRootButton = document.querySelector<HTMLButtonElement>('[data-select-root]');
const downloadConfigButton = document.querySelector<HTMLButtonElement>('[data-download-config]');
const copyConfigButton = document.querySelector<HTMLButtonElement>('[data-copy-config]');
const copyPromptButton = document.querySelector<HTMLButtonElement>('[data-copy-prompt]');
const toggleThemeButton = document.querySelector<HTMLButtonElement>('[data-toggle-theme]');
const toggleKeyButton = document.querySelector<HTMLButtonElement>('[data-toggle-key]');
const runFullCheckButton = document.querySelector<HTMLButtonElement>('[data-run-full-check]');
const consoleToggleButton = document.querySelector<HTMLButtonElement>('[data-console-toggle]');
const bottomConsoleEl = document.querySelector<HTMLElement>('[data-bottom-console]');
const checklistEl = document.querySelector<HTMLElement>('[data-checklist]');
const overallStatusEl = document.querySelector<HTMLElement>('[data-overall-status]');
const serviceSummaryEl = document.querySelector<HTMLElement>('[data-service-summary]');
const serviceStatusEl = document.querySelector<HTMLElement>('[data-service-status]');
const serviceOutputEl = document.querySelector<HTMLElement>('[data-service-output]');
const serviceButtons = document.querySelectorAll<HTMLButtonElement>('[data-service-action]');
const configFileEl = document.querySelector<HTMLElement>('[data-config-file]');
const configJsonEl = document.querySelector<HTMLElement>('[data-config-json]');
const configStatusEl = document.querySelector<HTMLElement>('[data-config-status]');
const keyPreviewEl = document.querySelector<HTMLElement>('[data-key-preview]');
const promptEl = document.querySelector<HTMLElement>('[data-start-prompt]');
const projectListEl = document.querySelector<HTMLElement>('[data-projects]');
const modesEl = document.querySelector<HTMLElement>('[data-modes]');
const diagnosticsEl = document.querySelector<HTMLElement>('[data-diagnostics]');
const diffEl = document.querySelector<HTMLElement>('[data-mcp-diff]');
const windowTitlebarEl = document.querySelector<HTMLElement>('[data-window-titlebar]');

let accessState: DesktopAccessState | null = null;
let uiState: DesktopUiState = defaultUiState();
let currentProjects: readonly SavedProjectProfile[] = [];
let currentPackage: DesktopConfigPackage | null = null;
let pendingServiceAction: PendingServiceActionConfirmation | null = null;

void refresh();

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

projectForm?.addEventListener('submit', event => {
  event.preventDefault();
  const project = projectDraftFromForm(projectForm);
  void window.watcherDesktop.projects.save(project)
    .then(saved => saveUiState({ ...uiState, lastProjectId: saved.id, activeSection: 'start' }))
    .then(() => refresh())
    .catch(error => writeLog(errorMessage(error)));
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

selectRootButton?.addEventListener('click', () => {
  void window.watcherDesktop.projects.selectRoot()
    .then(path => path ? saveRootProfile(path) : null)
    .then(() => refresh())
    .catch(error => writeLog(errorMessage(error)));
});

downloadConfigButton?.addEventListener('click', () => {
  void saveCurrentConfigPackage();
});

copyConfigButton?.addEventListener('click', () => {
  void copyText(currentPackage?.configJson ?? '')
    .then(() => writeLog('Файл настройки MCP скопирован'))
    .catch(error => writeLog(errorMessage(error)));
});

copyPromptButton?.addEventListener('click', () => {
  void copyText(currentPackage?.prompt ?? '')
    .then(() => writeLog('Стартовый prompt скопирован'))
    .catch(error => writeLog(errorMessage(error)));
});

toggleThemeButton?.addEventListener('click', () => {
  const theme = uiState.theme === 'light' ? 'dark' : 'light';
  void saveUiState({ ...uiState, theme }).then(() => renderUiState());
});

toggleKeyButton?.addEventListener('click', () => {
  void saveUiState({ ...uiState, keyVisible: !uiState.keyVisible }).then(() => renderCurrentPackage());
});

consoleToggleButton?.addEventListener('click', () => {
  void saveUiState({ ...uiState, consoleOpen: !uiState.consoleOpen }).then(() => renderUiState());
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
  void refresh();
});

checklistEl?.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>('[data-check-action]');
  if (!button) return;
  void handleCheckAction(button.dataset.checkAction).catch(error => writeLog(errorMessage(error)));
});

diagnosticsEl?.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>('[data-nav-section]');
  const activeSection = sectionFrom(button?.dataset.navSection);
  if (!activeSection) return;
  void goToSection(activeSection);
});

serviceButtons.forEach(button => {
  button.addEventListener('click', () => {
    const action = button.dataset.serviceAction;
    if (!isServiceAction(action)) return;
    void runServiceActionFromUi(action, action !== 'health');
  });
});

async function handleCheckAction(value: string | undefined): Promise<void> {
  const action = checkActionFrom(value);
  if (!action || action === 'none') return;
  switch (action) {
    case 'select_project':
      await goToSection('projects');
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
      writeLog('Проверяем MCP-сервер, ключ доступа и watcher...');
      await refresh();
      writeLog('Проверка завершена. Результат обновлён в чеклисте и диагностике.');
      return;
    case 'open_logs':
      await saveUiState({ ...uiState, consoleOpen: true });
      renderUiState();
      return;
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
  writeLog(`Выполняем: ${actionLabel(action)}...`);
  try {
    const result = await window.watcherDesktop.service.run({ action, projectId, confirmed: true });
    writeLog(serviceActionLog(result));
    await refresh();
  } catch (error) {
    writeLog(errorMessage(error));
  } finally {
    setServiceBusy(serviceButtons, false);
    setServiceConfirmationHint(serviceButtons, pendingServiceAction);
  }
}

async function saveCurrentConfigPackage(): Promise<void> {
  const result = await window.watcherDesktop.projects.saveConfigPackage(currentProjectId());
  writeLog(result ? configSaveLog(result) : 'Скачивание отменено');
  if (result) await refresh();
}

async function importConfigFromDialog(): Promise<void> {
  const result = await window.watcherDesktop.projects.importConfig();
  if (!result) {
    writeLog('Импорт файла настройки MCP отменён');
    return;
  }
  await saveUiState({
    ...uiState,
    lastProjectId: result.profile?.id ?? uiState.lastProjectId,
    activeSection: result.profile ? 'start' : 'projects',
  });
  writeLog(importResultLog(result));
  await refresh();
}

async function goToSection(activeSection: DesktopSection): Promise<void> {
  await saveUiState({ ...uiState, activeSection });
  renderUiState();
}

async function refresh(): Promise<void> {
  accessState = await safeAccessStatus();
  uiState = await safeUiState();
  renderShellAccess(accessState, { accountEl, appShellEl, authStatusEl, loginScreenEl });
  renderUiState();
  if (!accessState.signedIn) return;
  currentProjects = await safeProjects();
  renderProjectSelect(currentProjects, projectSelect, currentProjectId());
  hydrateProjectForm(projectForm, selectedProject(), accessState.config);
  const [check, pack, modes, diff] = await Promise.all([
    safeFullCheck(),
    safeConfigPackage(),
    safeModes(),
    safeDiff(),
  ]);
  currentPackage = pack;
  renderOverall(check, overallStatusEl);
  renderConnectionCheck(check, checklistEl);
  renderService(check.service, serviceStatusEl, serviceSummaryEl);
  renderCurrentPackage();
  renderProjects(currentProjects, projectListEl);
  renderModes(modes, modesEl);
  renderDiagnostics(check.diagnostics, diagnosticsEl);
  renderDiff(diff, diffEl);
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

async function safeDiff(): Promise<McpDiffPreview> {
  try {
    return await window.watcherDesktop.mcp.previewDiff('generic');
  } catch (error) {
    return { client: 'generic', configPath: 'недоступно', backupRequired: true, changes: [errorMessage(error)] };
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
  bottomConsoleEl?.toggleAttribute('hidden', !uiState.consoleOpen);
  setText(consoleToggleButton, uiState.consoleOpen ? 'Скрыть' : 'Показать');
}

function renderCurrentPackage(): void {
  renderConfigPackage(
    currentPackage,
    { configFileEl, configJsonEl, configStatusEl, keyPreviewEl, promptEl },
    uiState.keyVisible,
    accessState?.serverVerified === true,
  );
  setText(toggleKeyButton, uiState.keyVisible ? 'Скрыть' : 'Показать');
}

function currentProjectId(): string {
  return projectSelect?.value || uiState.lastProjectId || currentProjects[0]?.id || 'mcp-monorepo';
}

function selectedProject(): SavedProjectProfile | undefined {
  const projectId = currentProjectId();
  return currentProjects.find(project => project.id === projectId) ?? currentProjects[0];
}

function projectDraftFromForm(form: HTMLFormElement): ProjectDraft {
  const data = new FormData(form);
  return {
    id: String(data.get('id') ?? ''),
    name: String(data.get('name') ?? ''),
    root: String(data.get('root') ?? ''),
    indexId: String(data.get('indexId') ?? ''),
    serverUrl: String(data.get('serverUrl') ?? ''),
    tokenEnv: String(data.get('tokenEnv') ?? ''),
  };
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
    nodes: [{ id: 'runtime', label: 'Проверка подключения', status: 'error', detail: message, action: 'open_logs', actionLabel: 'Показать диагностику' }],
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
  setText(serviceOutputEl, value);
  if (!uiState.consoleOpen) void saveUiState({ ...uiState, consoleOpen: true }).then(() => renderUiState());
}

function serviceActionLog(result: WatcherServiceActionResult): string {
  const output = result.output.trim() || 'Команда завершилась без вывода';
  const lines = [
    `${decisionLabel(result.policy.decision)}: код=${result.exitCode ?? 'нет'}`,
    `Проект: ${result.status.projectId ?? currentProjectId()}`,
    `Папка: ${result.status.root ?? selectedProject()?.root ?? 'не определена'}`,
    output,
  ];
  if (result.status.lastError && !output.includes(result.status.lastError)) {
    lines.push(`Статус службы: ${result.status.lastError}`);
  }
  return lines.join('\n');
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
    consoleOpen: true,
    lastProjectId: null,
    keyVisible: false,
  };
}
