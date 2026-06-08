import type {
  DesktopAccessState,
  DesktopConfigPackage,
  DesktopConnectionCheck,
  DesktopModeSummary,
  DesktopSection,
  DesktopUiState,
  DiagnosticsPreview,
  McpConfigDiscovery,
  McpDiffPreview,
  SavedProjectProfile,
  WatcherServiceStatus,
} from './contracts.js';

export interface ShellRenderTargets {
  readonly accountEl: HTMLElement | null;
  readonly appShellEl: HTMLElement | null;
  readonly authStatusEl: HTMLElement | null;
  readonly loginScreenEl: HTMLElement | null;
}

export function renderShellAccess(state: DesktopAccessState, targets: ShellRenderTargets): void {
  document.body.dataset.access = state.signedIn ? 'signed-in' : 'signed-out';
  setText(targets.authStatusEl, state.message);
  targets.loginScreenEl?.toggleAttribute('hidden', state.signedIn);
  targets.appShellEl?.toggleAttribute('hidden', !state.signedIn);
  renderAccount(state, targets.accountEl);
}

export function applyUiState(state: DesktopUiState, sections: NodeListOf<HTMLElement>, navButtons: NodeListOf<HTMLButtonElement>): void {
  document.body.dataset.theme = state.theme;
  sections.forEach(section => section.toggleAttribute('hidden', section.dataset.section !== state.activeSection));
  navButtons.forEach(button => button.toggleAttribute('aria-current', button.dataset.navSection === state.activeSection));
}

export function renderProjectSelect(
  projects: readonly SavedProjectProfile[],
  select: HTMLSelectElement | null,
  selectedProjectId: string | null,
): void {
  if (!select) return;
  const current = selectedProjectId ?? projects[0]?.id ?? '';
  select.innerHTML = projects.length
    ? projects.map(project => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join('')
    : '<option value="">Проект не выбран</option>';
  select.value = current;
}

export function renderConnectionCheck(check: DesktopConnectionCheck, element: HTMLElement | null): void {
  if (!element) return;
  element.innerHTML = check.nodes.map(node => (
    `<article class="check-row" data-node="${escapeHtml(node.id)}">
      <span class="toggle ${node.status === 'active' ? 'on' : 'off'}" aria-hidden="true"></span>
      <div><strong>${escapeHtml(node.label)}</strong><p>${escapeHtml(node.detail)}</p></div>
      ${node.actionLabel ? `<button type="button" class="ghost" data-check-action="${node.action}">${escapeHtml(node.actionLabel)}</button>` : '<span class="check-ok">Активен</span>'}
    </article>`
  )).join('');
}

export function renderOverall(check: DesktopConnectionCheck, element: HTMLElement | null): void {
  if (!element) return;
  element.dataset.status = check.overall;
  setText(element, check.message);
}

export function renderService(status: WatcherServiceStatus, statusEl: HTMLElement | null, summaryEl: HTMLElement | null): void {
  setText(summaryEl, status.running ? 'Активен' : status.installed ? 'Остановлен' : 'Не установлен');
  const lines = [
    `Состояние: ${healthLabel(status.health)}`,
    `Служба: ${status.installed ? 'установлена' : 'не установлена'} / ${status.running ? 'запущена' : 'остановлена'}`,
    `Проект: ${status.projectId ?? 'не выбран'}`,
    `Папка: ${status.root ?? 'не выбрана'}`,
    `PID: ${status.pid ?? 'нет'}`,
    `Последняя синхронизация: ${status.lastSyncAt ?? 'нет данных'}`,
    `Очередь: ${status.queueDepth}`,
    `Ошибка: ${status.lastError ?? 'нет'}`,
  ];
  setText(statusEl, lines.join('\n'));
}

export function renderConfigPackage(pack: DesktopConfigPackage | null, targets: {
  readonly configFileEl: HTMLElement | null;
  readonly configJsonEl: HTMLElement | null;
  readonly configStatusEl: HTMLElement | null;
  readonly keyPreviewEl: HTMLElement | null;
  readonly promptEl: HTMLElement | null;
}, keyVisible: boolean): void {
  setText(targets.configFileEl, pack?.fileName ?? 'Проект не выбран');
  setText(targets.configJsonEl, pack?.configJson ?? 'Сначала выберите проект.');
  setText(targets.configStatusEl, pack ? `Проект: ${pack.projectId}. Secret: ${pack.secretPath ?? 'нет'}` : 'Пакет не собран');
  setText(targets.keyPreviewEl, pack ? keyText(pack, keyVisible) : 'Ключ недоступен');
  setText(targets.promptEl, pack?.prompt ?? 'Сначала выберите проект.');
}

export function renderProjects(projects: readonly SavedProjectProfile[], element: HTMLElement | null): void {
  if (!element) return;
  element.innerHTML = projects.length
    ? projects.map(project => (
      `<article class="project-row">
        <strong>${escapeHtml(project.name)}</strong>
        <span>${escapeHtml(project.id)}</span>
        <p>${escapeHtml(project.root)}</p>
      </article>`
    )).join('')
    : '<p class="empty-state">Выберите папку проекта, чтобы создать профиль.</p>';
}

export function renderModes(modes: readonly DesktopModeSummary[], element: HTMLElement | null): void {
  if (!element) return;
  element.innerHTML = modes.map(mode => (
    `<article class="mode-card" data-status="${mode.status}">
      <div class="panel-head">
        <div><h3>${escapeHtml(mode.title)}</h3><span>${escapeHtml(mode.technicalName)}</span></div>
        <strong>${escapeHtml(mode.status === 'ready' ? 'Готов' : mode.status === 'error' ? 'Ошибка' : 'Действие')}</strong>
      </div>
      <p>${escapeHtml(mode.summary)}</p>
      <div class="rail-line">${mode.rails.map(stage => `<span class="${stage.active ? 'active' : ''}" title="${escapeHtml(stage.detail)}">${escapeHtml(stage.label)}</span>`).join('')}</div>
    </article>`
  )).join('');
}

export function renderDiagnostics(diagnostics: DiagnosticsPreview, element: HTMLElement | null): void {
  if (!element) return;
  const findings = diagnostics.findings.length ? diagnostics.findings : ['Проблем не найдено'];
  element.innerHTML = findings.map((finding, index) => (
    `<article class="diagnostic-row">
      <strong>${index + 1}. ${escapeHtml(finding)}</strong>
      <p>Влияние: ${diagnostics.blocked ? 'контур требует исправления' : 'можно продолжать работу'}</p>
      <button type="button" class="ghost" data-nav-section="start">Открыть чеклист</button>
    </article>`
  )).join('');
}

export function renderDiff(diff: McpDiffPreview, element: HTMLElement | null): void {
  setText(element, `${diff.configPath}\nРезервная копия: ${diff.backupRequired ? 'да' : 'нет'}\n${diff.changes.join('\n')}`);
}

export function hydrateProjectForm(
  form: HTMLFormElement | null,
  project: SavedProjectProfile | undefined,
  config: McpConfigDiscovery,
): void {
  if (!form) return;
  const values = {
    id: project?.id ?? config.projectId ?? 'mcp-monorepo',
    name: project?.name ?? 'MCP Monorepo',
    root: project?.root ?? config.localPath ?? 'C:\\Users\\New\\Desktop\\MCP',
    indexId: project?.indexId ?? 'idx-mcp-monorepo',
    serverUrl: project?.serverUrl ?? config.serverUrl ?? '',
    tokenEnv: project?.tokenEnv ?? config.tokenEnv ?? 'MCP_BEARER_TOKEN',
  };
  for (const [name, value] of Object.entries(values)) {
    const input = form.elements.namedItem(name);
    if (input instanceof HTMLInputElement && input.value.length === 0) input.value = value;
  }
}

export function fallbackStatus(message: string): WatcherServiceStatus {
  return {
    installed: false,
    running: false,
    readOnly: true,
    health: 'read_only',
    projectId: null,
    root: null,
    pid: null,
    queueDepth: 0,
    lastSyncAt: null,
    lastError: message,
  };
}

export function setText(element: HTMLElement | null, value: string): void {
  if (element) element.textContent = value;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sectionFrom(value: string | undefined): DesktopSection | null {
  const sections: readonly DesktopSection[] = ['start', 'mcp', 'prompt', 'watcher', 'projects', 'modes', 'diagnostics', 'settings'];
  return typeof value === 'string' && sections.includes(value as DesktopSection) ? value as DesktopSection : null;
}

function renderAccount(state: DesktopAccessState, element: HTMLElement | null): void {
  if (!element) return;
  element.toggleAttribute('hidden', !state.signedIn);
  element.innerHTML = `<strong>${escapeHtml(state.email ?? 'Локальный профиль')}</strong><span>${escapeHtml(accessLabel(state.status))}</span><button type="button" class="ghost" data-access-logout>Выход</button>`;
}

function keyText(pack: DesktopConfigPackage, visible: boolean): string {
  if (!pack.tokenAvailable) return pack.tokenPreview;
  return visible ? pack.tokenValue ?? pack.tokenPreview : pack.tokenPreview;
}

function healthLabel(value: WatcherServiceStatus['health']): string {
  const labels = { not_configured: 'Не настроено', healthy: 'Работает', degraded: 'Требует внимания', stopped: 'Остановлена', read_only: 'Только чтение' };
  return labels[value];
}

function accessLabel(value: DesktopAccessState['status']): string {
  const labels = {
    signed_out: 'Вход не выполнен',
    config_missing: 'Нет файла настройки',
    secret_missing: 'Нет secret-файла',
    acl_failed: 'ACL не подтверждён',
    bearer_unverified: 'Bearer не проверен',
    server_pending: 'Ожидает серверной проверки',
    local_ready: 'Локально готово',
  };
  return labels[value];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
}
