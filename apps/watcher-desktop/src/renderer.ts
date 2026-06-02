import type {
  DesktopAccessState,
  DiagnosticsPreview,
  McpDiffPreview,
  SavedProjectProfile,
  WatcherServiceStatus,
} from './contracts.js';
import {
  errorMessage,
  fallbackStatus as fallbackServiceStatus,
  hydrateProjectForm,
  renderAccess as renderAccessView,
  renderDiagnostics,
  renderDiff,
  renderProjects,
  renderService,
  setText,
} from './renderer-view.js';
import { actionLabel, decisionLabel, isServiceAction, setServiceBusy } from './renderer-service-ui.js';

declare global {
  interface Window {
    readonly watcherDesktop: import('./contracts.js').WatcherDesktopApi;
  }
}

const authForm = document.querySelector<HTMLFormElement>('[data-auth-form]');
const projectForm = document.querySelector<HTMLFormElement>('[data-project-form]');
const authStatusEl = document.querySelector<HTMLElement>('[data-auth-status]');
const heroTitleEl = document.querySelector<HTMLElement>('[data-hero-title]');
const heroCopyEl = document.querySelector<HTMLElement>('[data-hero-copy]');
const profileCardEl = document.querySelector<HTMLElement>('[data-profile-card]');
const statusStripEl = document.querySelector<HTMLElement>('[data-status-strip]');
const configStatusEl = document.querySelector<HTMLElement>('[data-config-status]');
const gateListEl = document.querySelector<HTMLElement>('[data-gates]');
const serviceStatusEl = document.querySelector<HTMLElement>('[data-service-status]');
const projectListEl = document.querySelector<HTMLElement>('[data-projects]');
const diffEl = document.querySelector<HTMLElement>('[data-mcp-diff]');
const diagnosticsEl = document.querySelector<HTMLElement>('[data-diagnostics]');
const serviceOutputEl = document.querySelector<HTMLElement>('[data-service-output]');
const rootInput = document.querySelector<HTMLInputElement>('input[name="root"]');
const serviceButtons = document.querySelectorAll<HTMLButtonElement>('[data-service-action]');
const selectRootButton = document.querySelector<HTMLButtonElement>('[data-select-root]');
const importConfigButton = document.querySelector<HTMLButtonElement>('[data-import-config]');
const cabinetButton = document.querySelector<HTMLButtonElement>('[data-open-cabinet]');
const dashboardEl = document.querySelector<HTMLElement>('[data-dashboard]');
let accessState: DesktopAccessState | null = null;

void refresh();

authForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(authForm);
  setText(authStatusEl, 'Проверяем локальный доступ и файл настройки MCP...');
  void window.watcherDesktop.access.login({
    email: String(form.get('email') ?? ''),
    password: String(form.get('password') ?? ''),
  }).then(state => {
    accessState = state;
    if (state.signedIn) authForm.reset();
    return refresh();
  }).catch(error => setText(authStatusEl, errorMessage(error)));
});

projectForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(projectForm);
  void window.watcherDesktop.projects.save({
    id: String(form.get('id') ?? ''),
    name: String(form.get('name') ?? ''),
    root: String(form.get('root') ?? ''),
    indexId: String(form.get('indexId') ?? ''),
    serverUrl: String(form.get('serverUrl') ?? ''),
    tokenEnv: String(form.get('tokenEnv') ?? ''),
  }).then(() => {
    accessState = null;
    return refresh();
  }).catch(error => setText(serviceOutputEl, errorMessage(error)));
});

importConfigButton?.addEventListener('click', () => {
  void window.watcherDesktop.projects.importConfig().then(result => {
    if (!result) return;
    const warnings = result.warnings.length ? `\n${result.warnings.join('\n')}` : '';
    setText(serviceOutputEl, `Настройка импортирована: ${result.profile.name}${warnings}`);
    accessState = null;
    return refresh();
  }).catch(error => setText(serviceOutputEl, errorMessage(error)));
});

selectRootButton?.addEventListener('click', () => {
  void window.watcherDesktop.projects.selectRoot().then(path => {
    if (path && rootInput) rootInput.value = path;
  });
});

cabinetButton?.addEventListener('click', () => {
  window.open('http://149.33.14.250:3020', '_blank', 'noopener');
});

Array.from(serviceButtons).forEach(button => {
  button.addEventListener('click', () => {
    const action = button.dataset.serviceAction;
    if (!isServiceAction(action)) return;
    const projectId = getCurrentProjectId();
    if (action !== 'health' && !window.confirm(`Выполнить действие «${actionLabel(action)}» для ${projectId}?`)) return;
    setServiceBusy(serviceButtons, true);
    setText(serviceOutputEl, `Выполняем: ${actionLabel(action)}...`);
    void window.watcherDesktop.service.run({ action, projectId, confirmed: true })
      .then(result => {
        setText(serviceOutputEl, `${decisionLabel(result.policy.decision)}: код=${result.exitCode ?? 'нет'}\n${result.output}`);
        return refresh();
      })
      .catch(error => setText(serviceOutputEl, errorMessage(error)))
      .finally(() => setServiceBusy(serviceButtons, false));
  });
});

async function refresh(): Promise<void> {
  accessState ??= await readAccessStatus();
  renderAccess(accessState);
  const [status, projects, diff, diagnostics] = await Promise.all([
    safeStatus(),
    safeProjects(),
    safeDiff(),
    safeDiagnostics(),
  ]);
  renderService(status, serviceStatusEl);
  renderProjects(projects, projectListEl);
  renderDiff(diff, diffEl);
  renderDiagnostics(diagnostics, diagnosticsEl);
  hydrateProjectForm(projectForm, projects[0], accessState.config);
}

async function readAccessStatus(): Promise<DesktopAccessState> {
  try {
    return await window.watcherDesktop.access.status();
  } catch (error) {
    setText(authStatusEl, errorMessage(error));
    throw error;
  }
}

function renderAccess(state: DesktopAccessState): void {
  renderAccessView(state, {
    authStatusEl,
    configStatusEl,
    dashboardEl,
    gateListEl,
    heroCopyEl,
    heroTitleEl,
    profileCardEl,
    statusStripEl,
  });
}

async function safeStatus(): Promise<WatcherServiceStatus> {
  try {
    return await window.watcherDesktop.service.status();
  } catch (error) {
    return fallbackStatus(errorMessage(error));
  }
}

async function safeProjects(): Promise<readonly SavedProjectProfile[]> {
  try {
    return await window.watcherDesktop.projects.list();
  } catch (error) {
    setText(projectListEl, errorMessage(error));
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

async function safeDiagnostics(): Promise<DiagnosticsPreview> {
  try {
    return await window.watcherDesktop.diagnostics.previewExport();
  } catch (error) {
    return {
      blocked: true,
      requiresSecretConfirmation: true,
      readiness: 'deny',
      findings: [errorMessage(error)],
      included: [],
      secretWarnings: [],
      checks: [],
    };
  }
}

function fallbackStatus(message: string): WatcherServiceStatus {
  return fallbackServiceStatus(message);
}

function getCurrentProjectId(): string {
  const form = new FormData(projectForm ?? undefined);
  return String(form.get('id') ?? 'mcp-monorepo');
}
