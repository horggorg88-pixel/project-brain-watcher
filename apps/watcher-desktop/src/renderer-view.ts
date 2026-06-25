import type {
  DesktopAccessState,
  DesktopCodexGateRunEvidence,
  DesktopCodexGateStatus,
  DesktopConfigPackage,
  DesktopConnectionCheck,
  ManagedDeviceEnrollment,
  ManagedDeviceStatus,
  DesktopModeSummary,
  DesktopSection,
  DesktopUiState,
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
  const root = select.closest<HTMLElement>('[data-project-picker]');
  const trigger = root?.querySelector<HTMLButtonElement>('[data-project-select-button]');
  const valueEl = root?.querySelector<HTMLElement>('[data-custom-select-value]');
  const menu = root?.querySelector<HTMLElement>('[data-project-select-menu]');
  const activeProject = projects.find(project => project.id === current);
  setText(valueEl ?? null, activeProject?.name ?? 'Проект не выбран');
  if (trigger) {
    trigger.disabled = projects.length === 0;
    trigger.dataset.value = current;
  }
  if (menu) {
    menu.innerHTML = projects.length
      ? projects.map(project => customSelectOption({
        datasetName: 'data-project-option',
        value: project.id,
        label: project.name,
        detail: project.root,
        selected: project.id === current,
      })).join('')
      : '<span class="custom-select-empty">Проект не выбран</span>';
  }
}

export function renderConnectionCheck(check: DesktopConnectionCheck, element: HTMLElement | null): void {
  if (!element) return;
  element.innerHTML = check.nodes.map(node => (
    `<article class="check-row" data-node="${escapeHtml(node.id)}">
      <span class="toggle ${toggleClass(node.status)}" aria-hidden="true"></span>
      <div><strong>${escapeHtml(node.label)}</strong><p>${escapeHtml(node.detail)}</p></div>
      ${node.actionLabel ? `<button type="button" class="ghost" data-check-action="${node.action}" title="${escapeHtml(checkActionTooltip(node.action))}" data-tooltip="${escapeHtml(checkActionTooltip(node.action))}">${escapeHtml(node.actionLabel)}</button>` : `<span class="check-ok" data-status="${escapeHtml(node.status)}">${escapeHtml(checkStatusLabel(node.status))}</span>`}
    </article>`
  )).join('');
}

export function withCodexGateProgress(
  check: DesktopConnectionCheck,
  activeProjectId: string | null,
): DesktopConnectionCheck {
  if (!activeProjectId || (check.projectId ?? '') !== activeProjectId) return check;
  const nodes = check.nodes.map(node => node.id === 'codexGates'
    ? {
        ...node,
        status: 'waiting' as const,
        detail: 'Проверяем Codex CLI, hooks, smoke и rollback. Обычно это занимает до пары минут.',
        action: 'none' as const,
        actionLabel: null,
      }
    : node);
  return {
    ...check,
    overall: check.overall === 'ready' ? 'action_required' : check.overall,
    message: 'Проверяем Codex Gates.',
    nodes,
  };
}

export function formatAccessGateDiagnostics(state: DesktopAccessState): string {
  const lines = [
    'Диагностика доступа пульта',
    `Аккаунт: ${state.email ?? 'не выполнен вход'}`,
    `Статус: ${accessLabel(state.status)}`,
    `Сервер подтверждён: ${state.serverVerified ? 'да' : 'нет'}`,
    `Secret службы: ${state.serviceSecretConfigured ? 'готов' : 'не готов'}`,
    `MCP config: ${state.config.found ? state.config.source : 'не найден'}`,
    `configPath: ${state.config.configPath ?? 'нет данных'}`,
    `projectId: ${state.config.projectId ?? 'нет данных'}`,
    `localPath: ${state.config.localPath ?? 'нет данных'}`,
    `serverUrl: ${state.config.serverUrl ?? 'нет данных'}`,
    `Сообщение: ${state.message}`,
    'Gates:',
    ...state.gates.map((gate, index) => (
      `${index + 1}. ${gate.decision}/${gate.risk}: ${gate.reasons.map(redactLogValue).join('; ')}`
    )),
  ];
  return lines.map(redactLogValue).join('\n');
}

export function formatSupportEnrollmentLog(
  status: ManagedDeviceStatus,
  enrollment: ManagedDeviceEnrollment | null,
  projectId: string,
): string {
  const lines = [
    'Support-device enrollment',
    `projectId: ${projectId || 'нет данных'}`,
    `enrolled: ${status.enrolled ? 'да' : 'нет'}`,
    `health: ${status.health}`,
    `deviceId: ${status.deviceId ?? 'нет данных'}`,
    `supportBaseUrl: ${status.supportBaseUrl ?? 'нет данных'}`,
    `updatedAt: ${status.updatedAt ?? 'нет данных'}`,
    `statusMessage: ${status.message}`,
  ];
  if (enrollment) {
    lines.push(`enrollmentResult: ${enrollment.enrolled ? 'ok' : 'blocked'}`);
    lines.push(`enrollmentMessage: ${enrollment.message}`);
  } else {
    lines.push('next: запускаю автоматическую регистрацию support-device');
  }
  return lines.map(redactLogValue).join('\n');
}

export function formatCodexGateDiagnostics(status: DesktopCodexGateStatus, projectId: string): string {
  const lines = [
    'Codex Gates diagnostics',
    `projectId: ${projectId}`,
    `ready: ${status.ready ? 'да' : 'нет'}`,
    `checkedAt: ${status.checkedAt}`,
    `message: ${status.message}`,
    'Проверки:',
    ...codexEvidenceRows(status).map(formatCodexEvidenceRow),
  ];
  return lines.map(redactLogValue).join('\n');
}

function codexEvidenceRows(status: DesktopCodexGateStatus): readonly {
  readonly id: string;
  readonly label: string;
  readonly evidence: DesktopCodexGateRunEvidence | undefined;
}[] {
  const commandRuns = status.evidence.commandRuns;
  const verification = status.evidence.verification;
  return [
    { id: 'codexTrust', label: 'Codex project trust', evidence: verification.codexTrust },
    { id: 'codexRuntime', label: 'Codex CLI', evidence: verification.codexRuntime },
    { id: 'codexHooks', label: 'Persistent verifier hooks', evidence: commandRuns.codexHooks },
    { id: 'typecheck', label: 'Quality typecheck', evidence: commandRuns.typecheck },
    { id: 'lint', label: 'Quality lint', evidence: commandRuns.lint },
    { id: 'test', label: 'Quality test', evidence: commandRuns.test },
    { id: 'build', label: 'Quality build', evidence: commandRuns.build },
    { id: 'check', label: 'Quality check', evidence: commandRuns.check },
    { id: 'verify', label: 'Quality verify', evidence: commandRuns.verify },
    { id: 'desktopBootstrap', label: 'Desktop bootstrap', evidence: verification.desktopBootstrap },
    { id: 'managedHooks', label: 'Managed hooks', evidence: verification.managedHooks },
    { id: 'smoke', label: 'Project smoke', evidence: verification.smoke },
    { id: 'rollback', label: 'Rollback command', evidence: verification.rollback },
    { id: 'hookPersistence', label: 'Native SessionStart', evidence: verification.hookPersistence },
    { id: 'runtimeContext', label: 'Runtime Context', evidence: verification.runtimeContext },
  ];
}

function formatCodexEvidenceRow(row: {
  readonly id: string;
  readonly label: string;
  readonly evidence: DesktopCodexGateRunEvidence | undefined;
}): string {
  if (!row.evidence) return formatMissingCodexEvidenceRow(row);
  const state = codexEvidenceState(row.id, row.evidence);
  const exitCode = row.evidence.exitCode === undefined ? 'нет данных' : String(row.evidence.exitCode);
  const checkedAt = row.evidence.checkedAt ?? 'нет данных';
  return [
    `- ${row.label} (${row.id}): ${state}`,
    `exit=${exitCode}`,
    `source=${row.evidence.source}`,
    `checkedAt=${checkedAt}`,
    `command=${row.evidence.command}`,
    `detail=${row.evidence.detail}`,
  ].join(' | ');
}

function formatMissingCodexEvidenceRow(row: {
  readonly id: string;
  readonly label: string;
}): string {
  const detail = missingCodexEvidenceDetail(row.id);
  if (detail) return `- ${row.label} (${row.id}): waiting | detail=${detail}`;
  return `- ${row.label} (${row.id}): нет evidence`;
}

function codexEvidenceState(id: string, evidence: DesktopCodexGateRunEvidence): string {
  if (evidence.available === false) return id === 'smoke' ? 'not_configured' : 'unavailable';
  if (evidence.passed === true) return 'passed';
  if (evidence.passed === false) return 'failed';
  return 'unknown';
}

function missingCodexEvidenceDetail(id: string): string | null {
  if (['typecheck', 'lint', 'test', 'build', 'check', 'verify'].includes(id)) {
    return 'Native qualitygate.py ещё не запускал этот rail. Открой Codex в проекте и заверши ход, чтобы Stop hook записал evidence.';
  }
  if (id === 'hookPersistence') {
    return 'Открой или перезапусти Codex в проекте, чтобы native SessionStart подтвердил persistent-verifier.';
  }
  if (id === 'runtimeContext') {
    return 'Отправь сообщение в Codex или запусти subagent в проекте, чтобы native hooks записали Runtime Context proof.';
  }
  return null;
}

function toggleClass(status: string): string {
  if (status === 'active') return 'on';
  if (status === 'waiting') return 'wait';
  return 'off';
}

function checkStatusLabel(status: string): string {
  if (status === 'active') return 'Активен';
  if (status === 'waiting') return 'Ожидает';
  if (status === 'error') return 'Ошибка';
  return 'Нет действия';
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

export function renderModes(modes: readonly DesktopModeSummary[], element: HTMLElement | null, activeModeId: string | null = null): void {
  if (!element) return;
  if (modes.length === 0) {
    element.innerHTML = '<p class="empty-state">Режимы пока не загружены.</p>';
    return;
  }
  const activeMode = modes.find(mode => mode.id === activeModeId) ?? modes[0];
  const activeIndex = Math.max(0, modes.findIndex(mode => mode.id === activeMode?.id));
  if (!activeMode) return;
  element.innerHTML = `<section class="mode-group mode-browser" data-mode-browser data-active-mode="${escapeHtml(activeMode.id)}">
    <div class="mode-group-head mode-browser-head">
      <div>
        <h3>${escapeHtml(activeMode.group)}</h3>
        <span>${modes.length} режимов · выбран ${activeIndex + 1} из ${modes.length}</span>
      </div>
      <div class="mode-browser-actions">
        <button type="button" class="ghost icon-button" data-mode-step="prev" aria-label="Предыдущий режим" title="Предыдущий режим" data-tooltip="Предыдущий режим">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <button type="button" class="ghost icon-button" data-mode-step="next" aria-label="Следующий режим" title="Следующий режим" data-tooltip="Следующий режим">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>
    </div>
    <div class="custom-select-field mode-select-label" data-mode-picker data-custom-select>
      <span class="field-caption">Выбрать режим</span>
      <select class="native-select-fallback" data-mode-select tabindex="-1" aria-hidden="true">
        ${modes.map(mode => `<option value="${escapeHtml(mode.id)}" ${mode.id === activeMode.id ? 'selected' : ''}>${escapeHtml(mode.group)} / ${escapeHtml(mode.title)}</option>`).join('')}
      </select>
      <button type="button" class="custom-select-trigger" data-custom-select-toggle data-mode-select-button aria-haspopup="listbox" aria-expanded="false" title="Открыть список режимов" data-tooltip="Открыть список режимов">
        <span data-custom-select-value>${escapeHtml(activeMode.group)} / ${escapeHtml(activeMode.title)}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <div class="custom-select-menu" data-custom-select-menu data-mode-select-menu role="listbox" hidden>
        ${modes.map(mode => customSelectOption({
          datasetName: 'data-mode-option',
          value: mode.id,
          label: `${mode.group} / ${mode.title}`,
          detail: mode.summary,
          selected: mode.id === activeMode.id,
        })).join('')}
      </div>
    </div>
    <div class="mode-carousel" data-mode-carousel>
      ${renderModeCard(activeMode)}
    </div>
  </section>`;
}

function customSelectOption(option: {
  readonly datasetName: string;
  readonly detail: string;
  readonly label: string;
  readonly selected: boolean;
  readonly value: string;
}): string {
  return `<button type="button" class="custom-select-option" ${option.datasetName}="${escapeHtml(option.value)}" role="option" aria-selected="${option.selected ? 'true' : 'false'}" ${option.selected ? 'data-selected="true"' : ''}>
    <span>${escapeHtml(option.label)}</span>
    <small>${escapeHtml(option.detail)}</small>
  </button>`;
}

function checkActionTooltip(action: string): string {
  const labels: Record<string, string> = {
    download_config: 'Скачать файл настройки MCP для выбранного проекта',
    import_config: 'Импортировать файл настройки MCP в пульт',
    install_service: 'Установить Windows-службу watcher для проекта',
    open_logs: 'Открыть нижнюю панель логов watcher',
    select_project: 'Выбрать рабочую папку проекта',
    start_service: 'Запустить watcher для выбранного проекта',
    verify: 'Повторить проверку MCP-сервера, ключа и watcher',
    verify_codex_gates: 'Установить persistent-verifier и проверить native Codex SessionStart hook',
  };
  return labels[action] ?? 'Выполнить действие чеклиста';
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
  const sections: readonly DesktopSection[] = ['start', 'prompt', 'watcher', 'modes'];
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
  if (status.running && status.health === 'healthy') return 'Watcher работает';
  if (!status.running) return 'Watcher остановлен';
  return 'Watcher требует внимания';
}

function serviceSummaryStatus(status: WatcherServiceStatus): DesktopConnectionCheck['overall'] {
  if (!status.installed || !status.running) return 'action_required';
  if (status.running && status.health === 'healthy') return 'ready';
  return 'error';
}

function overallSummary(check: DesktopConnectionCheck): string {
  if (check.overall === 'ready') return 'Подключение готово';
  const blocker = check.nodes.find(node => node.status !== 'active');
  const reason = blocker?.label ?? 'причина';
  return check.overall === 'error' ? `Проверка остановлена: ${reason}` : `Нужен шаг: ${reason}`;
}

function serviceNextStep(status: WatcherServiceStatus): string {
  if (!status.installed) return 'Установите службу watcher';
  if (status.running && status.health === 'healthy') return 'Можно работать через MCP';
  if (!status.running) return 'Запустите watcher';
  if (status.health !== 'healthy') return 'Проверьте обзорный чеклист и MCP-доступ';
  return 'Проверьте обзорный чеклист и MCP-доступ';
}

function serviceLogLines(status: WatcherServiceStatus): readonly string[] {
  const logs = status.logs;
  if (!logs) return [];
  const sections = [
    logSection('Лог работы watcher', logs.out, logs.outPath),
    logSection('Ошибки watcher', logs.err, logs.errPath),
    logSection('Лог Windows-службы', logs.wrapper, logs.wrapperPath),
    logSection('Лог установки runtime watcher', logs.runtimeInstall, logs.runtimeInstallPath),
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

function redactLogValue(value: string): string {
  return value
    .replace(/\bBearer\s+(?:sk-[A-Za-z0-9._-]+|[A-Za-z0-9._~+/=-]{16,})/gi, 'Bearer [REDACTED]')
    .replace(/\bpb_[A-Za-z0-9_-]{8,}\b/g, 'pb_[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9._-]{8,}/g, 'sk-[REDACTED]')
    .replace(
      /\b((?:MCP_BEARER_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|TOKEN|SECRET|PASSWORD|KEY)\s*[:=]\s*)(["']?)[^\s"',;]+/gi,
      '$1$2[REDACTED]',
    );
}
