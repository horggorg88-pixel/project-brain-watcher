import type {
  DesktopAccessState,
  DesktopConfigPackage,
  DesktopConnectionCheck,
  DesktopModeSummary,
  DesktopSection,
  DesktopUiState,
  McpConfigDiscovery,
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
  document.body.dataset.serverVerified = state.serverVerified ? 'true' : 'false';
  setText(targets.authStatusEl, state.message);
  targets.loginScreenEl?.toggleAttribute('hidden', state.signedIn);
  targets.appShellEl?.toggleAttribute('hidden', !state.signedIn);
  renderAccount(state, targets.accountEl);
}

export function applyUiState(state: DesktopUiState, sections: NodeListOf<HTMLElement>, navButtons: NodeListOf<HTMLButtonElement>): void {
  document.body.dataset.theme = state.theme;
  sections.forEach(section => section.toggleAttribute('hidden', section.dataset.section !== state.activeSection));
  navButtons.forEach(button => {
    if (button.dataset.navSection === state.activeSection) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.removeAttribute('aria-current');
    }
  });
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

export function renderConnectionCause(check: DesktopConnectionCheck, element: HTMLElement | null): void {
  if (!element) return;
  const blocker = check.nodes.find(node => node.status !== 'active');
  element.dataset.status = check.overall;
  setText(element, blocker ? `Причина: ${blocker.label}: ${blocker.detail}` : 'Причина: контур MCP готов');
}

export function renderOverall(check: DesktopConnectionCheck, element: HTMLElement | null): void {
  if (!element) return;
  element.dataset.status = check.overall;
  setText(element, overallSummary(check));
}

export function renderService(status: WatcherServiceStatus, statusEl: HTMLElement | null, summaryEl: HTMLElement | null): void {
  if (summaryEl) summaryEl.dataset.status = serviceSummaryStatus(status);
  setText(summaryEl, serviceSummary(status));
  const lines = [
    `Состояние подключения: ${healthLabel(status.health)}`,
    `Служба: ${status.installed ? 'установлена' : 'не установлена'}`,
    `Запуск: ${status.running ? 'watcher запущен' : 'watcher остановлен'}`,
    `Проект: ${status.projectId ?? 'не выбран'}`,
    `Папка проекта: ${status.root ?? 'не выбрана'}`,
    `Очередь индексации: ${status.queueDepth}`,
    `Последняя синхронизация: ${status.lastSyncAt ?? 'нет данных'}`,
    `Следующий шаг: ${serviceNextStep(status)}`,
  ];
  if (status.pid) lines.push(`PID: ${status.pid}`);
  if (status.lastError) lines.push(`Сообщение watcher: ${status.lastError}`);
  const logLines = serviceLogLines(status);
  if (logLines.length) lines.push('', ...logLines);
  setText(statusEl, lines.join('\n'));
}

export function renderConfigPackage(pack: DesktopConfigPackage | null, targets: {
  readonly configFileEl: HTMLElement | null;
  readonly configJsonEl: HTMLElement | null;
  readonly configStatusEl: HTMLElement | null;
  readonly keyPreviewEl: HTMLElement | null;
  readonly promptEl: HTMLElement | null;
}, keyVisible: boolean, serverVerified: boolean): void {
  setText(targets.configFileEl, pack?.fileName ?? 'Проект не выбран');
  setText(targets.configJsonEl, pack?.configJson ?? 'Сначала выберите проект.');
  setText(targets.configStatusEl, pack ? configPackageStatus(pack, serverVerified) : 'Пакет не собран');
  setText(targets.keyPreviewEl, pack ? keyText(pack, keyVisible) : 'Ключ недоступен');
  setText(targets.promptEl, pack ? promptText(pack, serverVerified) : 'Сначала выберите проект.');
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
  const groups = [...new Set(modes.map(mode => mode.group))];
  element.innerHTML = groups.map(group => (
    `<section class="mode-group">
      <div class="mode-group-head">
        <h3>${escapeHtml(group)}</h3>
        <span>${modes.filter(mode => mode.group === group).length} режимов</span>
      </div>
      <div class="mode-grid">
        ${modes.filter(mode => mode.group === group).map(renderModeCard).join('')}
      </div>
    </section>`
  )).join('');
}

function renderModeCard(mode: DesktopModeSummary): string {
  return `<article class="mode-card" data-status="${mode.status}">
    <div class="panel-head">
      <div>
        <h4>${escapeHtml(mode.title)}</h4>
        <span>${escapeHtml(mode.technicalName)}</span>
      </div>
      <strong>${escapeHtml(mode.status === 'ready' ? 'Готов' : mode.status === 'error' ? 'Ошибка' : 'Действие')}</strong>
    </div>
    <p class="mode-summary">${escapeHtml(mode.summary)}</p>
    <p class="mode-description">${escapeHtml(mode.description)}</p>
    <dl class="mode-facts">
      ${mode.aliases?.length ? `<div><dt>Триггеры</dt><dd>${escapeHtml(mode.aliases.join(', '))}</dd></div>` : ''}
      <div><dt>Когда применять</dt><dd>${escapeHtml(mode.whenToUse)}</dd></div>
      ${mode.confusionGuard ? `<div><dt>Не путать</dt><dd>${escapeHtml(mode.confusionGuard)}</dd></div>` : ''}
      <div><dt>Кейсы</dt><dd><ul>${mode.useCases.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></dd></div>
    </dl>
    <div class="rail-line">${mode.rails.map(stage => `<span class="${stage.active ? 'active' : ''}" title="${escapeHtml(stage.detail)}">${escapeHtml(stage.label)}</span>`).join('')}</div>
  </article>`;
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
    logs: null,
  };
}

export function setText(element: HTMLElement | null, value: string): void {
  if (element) element.textContent = value;
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return userFacingError(message);
}

export function sectionFrom(value: string | undefined): DesktopSection | null {
  const sections: readonly DesktopSection[] = ['start', 'prompt', 'watcher', 'projects', 'modes'];
  return typeof value === 'string' && sections.includes(value as DesktopSection) ? value as DesktopSection : null;
}

function renderAccount(state: DesktopAccessState, element: HTMLElement | null): void {
  if (!element) return;
  element.toggleAttribute('hidden', !state.signedIn);
  element.innerHTML = `<strong>${escapeHtml(state.email ?? 'Локальный профиль')}</strong><span>${escapeHtml(accessLabel(state.status))}</span><button type="button" class="ghost" data-access-logout>Выход</button>`;
}

function keyText(pack: DesktopConfigPackage, visible: boolean): string {
  if (!pack.tokenAvailable) return pack.tokenPreview;
  return visible ? `Полный ключ показан временно: ${pack.tokenValue ?? pack.tokenPreview}` : `Ключ скрыт: ${pack.tokenPreview}`;
}

function healthLabel(value: WatcherServiceStatus['health']): string {
  const labels = { not_configured: 'Нужно настроить', healthy: 'Работает', degraded: 'Требует внимания', stopped: 'Остановлен', read_only: 'Только чтение' };
  return labels[value];
}

function accessLabel(value: DesktopAccessState['status']): string {
  const labels = {
    signed_out: 'Вход не выполнен',
    config_missing: 'Нет файла настройки',
    secret_missing: 'Ключ не сохранён',
    acl_failed: 'Защита ключа требует внимания',
    bearer_unverified: 'Ключ нужно проверить',
    server_pending: 'Сервер проверяется',
    local_ready: 'Пульт готов',
  };
  return labels[value];
}

function serviceSummary(status: WatcherServiceStatus): string {
  if (!status.installed) return 'Watcher не установлен';
  if (!status.running) return 'Watcher остановлен';
  return status.health === 'healthy' ? 'Watcher работает' : 'Watcher требует внимания';
}

function serviceSummaryStatus(status: WatcherServiceStatus): DesktopConnectionCheck['overall'] {
  if (!status.installed || !status.running) return 'action_required';
  return status.health === 'healthy' ? 'ready' : 'error';
}

function overallSummary(check: DesktopConnectionCheck): string {
  if (check.overall === 'ready') return 'Подключение готово';
  const blocker = check.nodes.find(node => node.status !== 'active');
  const reason = blocker?.label ?? 'причина';
  return check.overall === 'error' ? `Проверка остановлена: ${reason}` : `Нужен шаг: ${reason}`;
}

function serviceNextStep(status: WatcherServiceStatus): string {
  if (!status.installed) return 'Установите службу watcher';
  if (!status.running) return 'Запустите watcher';
  if (status.health !== 'healthy') return 'Проверьте обзорный чеклист и MCP-доступ';
  return 'Можно работать через MCP';
}

function serviceLogLines(status: WatcherServiceStatus): readonly string[] {
  const logs = status.logs;
  if (!logs) return [];
  const sections = [
    logSection('Лог работы watcher', logs.out, logs.outPath),
    logSection('Ошибки watcher', logs.err, logs.errPath),
    logSection('Лог Windows-службы', logs.wrapper, logs.wrapperPath),
  ].filter((line): line is string => line !== null);
  return sections.length ? ['Последние логи:', ...sections] : ['Последние логи: файлов логов пока нет'];
}

function logSection(title: string, value: string, path: string): string | null {
  if (!value.trim()) return null;
  return `${title} (${path}):\n${value}`;
}

function configKeyStatus(pack: DesktopConfigPackage): string {
  if (!pack.tokenAvailable) return 'Ключ пока не найден';
  return `Ключ доступен: ${pack.tokenPreview}`;
}

function configPackageStatus(pack: DesktopConfigPackage, serverVerified: boolean): string {
  const promptStatus = serverVerified ? 'Стартовый промт готов и не содержит ключ.' : 'Стартовый промт откроется после проверки MCP-сервера.';
  return `Проект: ${pack.projectId}. ${configKeyStatus(pack)}. ${promptStatus}`;
}

function promptText(pack: DesktopConfigPackage, serverVerified: boolean): string {
  if (serverVerified) return pack.prompt;
  return 'Сначала подтвердите MCP-сервер и барьер-ключ в разделе «Проверка контура». После успешной проверки пульт покажет стартовый Brain MCP bootstrap-промт.';
}

function userFacingError(message: string): string {
  if (/project_route_conflict/i.test(message)) return 'MCP привязан к другому проекту. Переинициализируйте route для текущей папки.';
  if (/runtime_session_required/i.test(message)) return 'MCP runtime не открыт. Сначала запустите runtime_start через стартовый prompt.';
  if (/runtime_policy_required|policy/i.test(message)) return 'Policy gate не подтверждён. Повторите проверку MCP-подключения.';
  if (/unauthorized|forbidden|401|403/i.test(message)) return 'MCP-сервер не принял ключ доступа. Проверьте барьер-ключ и импортированный файл.';
  if (/failed to fetch|network|econnrefused|etimedout/i.test(message)) return 'Пульт не достучался до MCP-сервера. Проверьте интернет, адрес сервера и watcher.';
  return message;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
}
