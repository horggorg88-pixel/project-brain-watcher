import type {
  DesktopAccessState,
  DiagnosticsPreview,
  McpConfigDiscovery,
  McpDiffPreview,
  SavedProjectProfile,
  WatcherPolicyGate,
  WatcherServiceStatus,
} from './contracts.js';

export interface AccessRenderTargets {
  readonly authStatusEl: HTMLElement | null;
  readonly configStatusEl: HTMLElement | null;
  readonly dashboardEl: HTMLElement | null;
  readonly gateListEl: HTMLElement | null;
  readonly heroCopyEl: HTMLElement | null;
  readonly heroTitleEl: HTMLElement | null;
  readonly profileCardEl: HTMLElement | null;
  readonly statusStripEl: HTMLElement | null;
}

export function renderAccess(state: DesktopAccessState, targets: AccessRenderTargets): void {
  document.body.dataset.access = state.signedIn ? 'signed-in' : 'signed-out';
  setText(targets.authStatusEl, state.message);
  setText(targets.heroTitleEl, state.signedIn ? 'Project Brain Watcher открыт' : 'Подключите watcher');
  setText(targets.heroCopyEl, state.signedIn
    ? 'Вход выполнен. Импортируйте файл настройки MCP и проверьте подключение watcher.'
    : 'После входа откроется простой пульт: импорт настройки MCP, проверка watcher и администрирование по требованию.');
  renderProfileCard(state, targets.profileCardEl);
  renderStatusStrip(state, targets.statusStripEl);
  targets.dashboardEl?.toggleAttribute('hidden', !state.signedIn);
  renderConfig(state.config, targets.configStatusEl);
  renderGates(state.gates, targets.gateListEl);
}

export function renderService(status: WatcherServiceStatus, element: HTMLElement | null): void {
  const lines = [
    `Состояние: ${healthLabel(status.health)}`,
    `Служба: ${status.installed ? 'установлена' : 'не установлена'} / ${status.running ? 'запущена' : 'остановлена'}`,
    `Проект: ${status.projectId ?? 'не выбран'}`,
    `Папка: ${status.root ?? 'не выбрана'}`,
    `PID: ${status.pid ?? 'нет'}`,
    `Последняя синхронизация: ${status.lastSyncAt ?? 'нет данных'}`,
    `Повторные попытки: ${status.queueDepth}`,
    `Ошибка: ${status.lastError ?? 'нет'}`,
  ];
  setText(element, lines.join('\n'));
}

export function renderProjects(projects: readonly SavedProjectProfile[], element: HTMLElement | null): void {
  const text = projects.length === 0
    ? 'Профили ещё не сохранены. Выберите папку проекта и сохраните профиль.'
    : projects.map(project => `${project.name}\n${project.root}\n${project.serverUrl || 'MCP сервер не задан'} / ${project.tokenEnv}`).join('\n\n');
  setText(element, text);
}

export function renderDiff(diff: McpDiffPreview, element: HTMLElement | null): void {
  setText(element, `${diff.configPath}\nРезервная копия: ${diff.backupRequired ? 'да' : 'нет'}\n${diff.changes.join('\n')}`);
}

export function renderDiagnostics(diagnostics: DiagnosticsPreview, element: HTMLElement | null): void {
  const secretGate = diagnostics.requiresSecretConfirmation
    ? `Полный пакет: требуется подтверждение\nСекреты: ${diagnostics.secretWarnings.join(', ')}`
    : 'Полный пакет: без секретов';
  const checks = diagnostics.checks.map(check => `${decisionLabel(check.decision)}: ${check.reasons.join(' ')}`);
  setText(element, `Готовность: ${decisionLabel(diagnostics.readiness)}\n${secretGate}\n\n${checks.join('\n')}\n\n${diagnostics.findings.join('\n')}\n\n${diagnostics.included.join('\n')}`);
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

function renderConfig(config: McpConfigDiscovery, element: HTMLElement | null): void {
  const lines = config.found
    ? [
      `Источник: ${sourceLabel(config.source)}`,
      `Файл: ${config.configPath ?? 'не указан'}`,
      `Сервер: ${config.serverUrl ?? 'не найден'}`,
      `Переменная токена: ${config.tokenEnv ?? 'не найдена'}`,
      `Проект: ${config.projectId ?? 'выбирается в приложении'}`,
    ]
    : ['Файл настройки MCP не найден', ...config.findings];
  setText(element, lines.join('\n'));
}

function renderGates(gates: readonly WatcherPolicyGate[], element: HTMLElement | null): void {
  if (!element) return;
  element.innerHTML = gates.map(gate => (
    `<li><span class="pill ${gate.decision}">${decisionLabel(gate.decision)}</span>${escapeHtml(gate.reasons.join(' '))}</li>`
  )).join('');
}

function renderProfileCard(state: DesktopAccessState, element: HTMLElement | null): void {
  if (!element) return;
  element.toggleAttribute('hidden', !state.signedIn);
  const gate = state.serverVerified ? 'сервер подтверждён' : 'локальная проверка';
  element.innerHTML = `<p>${escapeHtml(state.email ?? 'Локальный профиль')}</p><span>${escapeHtml(accessLabel(state.status))} · ${gate}</span>`;
}

function renderStatusStrip(state: DesktopAccessState, element: HTMLElement | null): void {
  if (!element) return;
  const allowCount = state.gates.filter(gate => gate.decision === 'allow').length;
  const cards = [
    ['Настройка MCP', state.config.found ? 'Готово' : 'Нужно импортировать', state.config.found ? `Источник: ${sourceLabel(state.config.source)}` : 'Скачайте файл в личном кабинете'],
    ['Учётная запись', state.signedIn ? 'Готово' : 'Нужно войти', state.email ?? 'Вход не выполнен'],
    ['Secret службы', state.serviceSecretConfigured ? 'Готово' : 'Нужен импорт', state.serviceSecretConfigured ? 'Bearer сохранён локально' : 'Скачайте конфиг в личном кабинете'],
    ['Допуск', `${allowCount}/${state.gates.length}`, state.gates.map(gate => decisionLabel(gate.decision)).join(' / ')],
  ] as const;
  element.innerHTML = cards.map(([title, mark, detail]) => (
    `<div class="status-card"><span>${escapeHtml(title)}</span><strong>${escapeHtml(mark)}</strong><p>${escapeHtml(detail)}</p></div>`
  )).join('');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
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

function decisionLabel(value: WatcherPolicyGate['decision']): string {
  const labels = { allow: 'Разрешено', prompt: 'Требует подтверждения', deny: 'Запрещено' };
  return labels[value];
}

function sourceLabel(value: McpConfigDiscovery['source']): string {
  const labels = { codex: 'Codex', claude: 'Claude', cursor: 'Cursor', generic: 'общий файл', none: 'не найден' };
  return labels[value];
}
