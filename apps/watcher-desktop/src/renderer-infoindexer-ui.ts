import type { DesktopInfoIndexerToolResult, DesktopJsonObject, DesktopJsonValue, WatcherDesktopApi } from './contracts.js';

type InfoIndexerApi = WatcherDesktopApi['infoIndexer'];

export interface InfoIndexerUi {
  renderProject(projectId: string, source: 'dedicated' | 'selected' | 'missing'): void;
}

export function setupInfoIndexerSection(input: Readonly<{
  api: InfoIndexerApi;
  getProjectId(): string;
  writeLog(value: string): void;
}>): InfoIndexerUi {
  const root = document.querySelector<HTMLElement>('[data-infoindexer-root]');
  if (!root) return { renderProject: () => undefined };
  const els = {
    query: getInput(root, '[data-infoindexer-query]'),
    health: getButton(root, '[data-infoindexer-health]'),
    ingest: getButton(root, '[data-infoindexer-ingest]'),
    job: getButton(root, '[data-infoindexer-job]'),
    form: root.querySelector<HTMLFormElement>('[data-infoindexer-search-form]'),
    status: root.querySelector<HTMLElement>('[data-infoindexer-status]'),
    project: root.querySelector<HTMLElement>('[data-infoindexer-project]'),
    results: root.querySelector<HTMLElement>('[data-infoindexer-results]'),
    selected: root.querySelector<HTMLElement>('[data-infoindexer-selected]'),
    detail: root.querySelector<HTMLElement>('[data-infoindexer-detail-output]'),
    receipt: root.querySelector<HTMLElement>('[data-infoindexer-receipt]'),
  };
  let lastJobId = '';

  els.health?.addEventListener('click', () => {
    void runOperation('health', els.health, async () => {
      const result = await input.api.health({ projectId: requireProjectId(input.getProjectId()) });
      setText(els.status, healthLabel(structured(result)));
      renderReceipt(els.receipt, result);
    }, input.writeLog);
  });

  els.form?.addEventListener('submit', event => {
    event.preventDefault();
    void runOperation('search', els.form, async () => {
      const query = els.query?.value.trim() ?? '';
      if (!query) {
        els.query?.setAttribute('aria-invalid', 'true');
        renderEmpty(els.results, 'Введите компанию', 'Пустой поиск не отправляется на сервер.');
        renderReceipt(els.receipt, { ok: false, content: 'Нужен запрос', structuredContent: { required_next: 'provide_company_query' } });
        setText(els.status, 'Нужен запрос');
        return;
      }
      els.query?.removeAttribute('aria-invalid');
      renderLoading(els.results, `Ищем «${query}»...`);
      const result = await input.api.searchCompanies({
        projectId: requireProjectId(input.getProjectId()),
        query,
        limit: 25,
        projection: 'compact',
      });
      renderResults(els.results, structured(result), companyId => {
        void loadCompany(companyId);
      });
      renderReceipt(els.receipt, result);
      setText(els.status, result.ok ? 'Результаты обновлены' : 'Поиск вернул диагностику');
    }, input.writeLog);
  });

  els.ingest?.addEventListener('click', () => {
    void runOperation('ingest', els.ingest, async () => {
      const result = await input.api.startIngest({
        projectId: requireProjectId(input.getProjectId()),
        source: 'companies',
        mode: 'incremental',
        idempotencyKey: 'infoindexer:ingest:companies:incremental',
      });
      lastJobId = stringValue(structured(result).job_id) ?? stringValue(objectValue(structured(result).job)?.job_id) ?? lastJobId;
      renderReceipt(els.receipt, result);
      setText(els.status, lastJobId ? `Задача ${lastJobId}` : 'Загрузка поставлена в очередь');
    }, input.writeLog);
  });

  els.job?.addEventListener('click', () => {
    void runOperation('job', els.job, async () => {
      const jobId = lastJobId || globalThis.prompt('job_id')?.trim() || '';
      if (!jobId) return;
      lastJobId = jobId;
      const result = await input.api.jobStatus({ projectId: requireProjectId(input.getProjectId()), jobId });
      renderReceipt(els.receipt, result);
      setText(els.status, `Задача ${jobId} проверена`);
    }, input.writeLog);
  });

  async function loadCompany(companyId: string): Promise<void> {
    await runOperation('detail', null, async () => {
      setText(els.selected, companyId);
      setText(els.detail, 'Загружаем карточку...');
      const result = await input.api.getCompany({
        projectId: requireProjectId(input.getProjectId()),
        companyId,
        sections: ['summary', 'contacts', 'reports', 'sanctions', 'connections'],
      });
      setText(els.detail, JSON.stringify(structured(result), null, 2));
      renderReceipt(els.receipt, result);
      setText(els.status, `Открыта карточка ${companyId}`);
    }, input.writeLog);
  }

  return {
    renderProject(projectId, source) {
      const suffix = source === 'dedicated' ? ' · профиль infoindexer' : source === 'selected' ? ' · выбранный проект' : '';
      setText(els.project, projectId ? `${projectId}${suffix}` : 'Проект не выбран');
    },
  };
}

function renderResults(target: HTMLElement | null, content: DesktopJsonObject, openCompany: (companyId: string) => void): void {
  const rows = resultRows(content);
  if (rows.length === 0) {
    const requiredNext = stringValue(content.required_next);
    renderEmpty(target, requiredNext ? 'Нужна настройка источника' : 'Компания не найдена', requiredNext ?? 'Совпадений нет.');
    return;
  }
  if (!target) return;
  target.innerHTML = `<table class="infoindexer-table"><thead><tr><th>Компания</th><th>ИНН / ID</th><th>Статус</th><th>Риск</th><th>Источник</th></tr></thead><tbody>${rows.map(renderRow).join('')}</tbody></table>`;
  target.querySelectorAll<HTMLTableRowElement>('tr[data-company-id]').forEach(row => {
    row.addEventListener('click', () => {
      const companyId = row.dataset.companyId ?? '';
      if (companyId) openCompany(companyId);
    });
  });
}

function resultRows(content: DesktopJsonObject): readonly ResultRow[] {
  const candidates = arrayValue(content.results) ?? arrayValue(content.companies) ?? arrayValue(content.partial_result) ?? [];
  return candidates.map(item => {
    const record = objectValue(item) ?? {};
    return {
      id: stringValue(record.company_id) ?? stringValue(record.id) ?? '',
      name: stringValue(record.name) ?? stringValue(record.title) ?? 'неизвестно',
      inn: stringValue(record.inn) ?? stringValue(record.tax_id) ?? 'нет данных',
      status: stringValue(record.status) ?? stringValue(record.registry_status) ?? 'неизвестно',
      risk: stringValue(record.risk) ?? stringValue(record.risk_level) ?? 'нет данных',
      source: stringValue(record.source) ?? stringValue(record.provider) ?? 'индекс',
    };
  });
}

function renderRow(row: ResultRow): string {
  const id = row.id ? ` data-company-id="${escapeAttr(row.id)}"` : '';
  return `<tr${id}><td><strong>${escapeHtml(row.name)}</strong></td><td>${escapeHtml(row.inn || row.id)}</td><td><span class="infoindexer-pill">${escapeHtml(row.status)}</span></td><td><span class="infoindexer-pill">${escapeHtml(row.risk)}</span></td><td>${escapeHtml(row.source)}</td></tr>`;
}

async function runOperation(name: string, control: Element | null, action: () => Promise<void>, writeLog: (value: string) => void): Promise<void> {
  setBusy(control, true);
  try {
    await action();
  } catch (error) {
    writeLog(`InfoIndexer ${name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    setBusy(control, false);
  }
}

function healthLabel(content: DesktopJsonObject): string {
  const status = stringValue(content.status) ?? 'неизвестно';
  const requiredNext = stringValue(content.required_next);
  return requiredNext ? `статус: ${status} · следующий шаг: ${requiredNext}` : `статус: ${status}`;
}

function structured(result: DesktopInfoIndexerToolResult): DesktopJsonObject {
  return result.structuredContent ?? {};
}

function renderReceipt(target: HTMLElement | null, value: unknown): void {
  setText(target, JSON.stringify(value, null, 2));
}

function renderLoading(target: HTMLElement | null, message: string): void {
  if (target) target.innerHTML = `<div class="empty-state"><strong>${escapeHtml(message)}</strong></div>`;
}

function renderEmpty(target: HTMLElement | null, title: string, message: string): void {
  if (target) target.innerHTML = `<div class="empty-state"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`;
}

function requireProjectId(projectId: string): string {
  if (projectId) return projectId;
  throw new Error('Проект для InfoIndexer не выбран.');
}

function setBusy(control: Element | null, busy: boolean): void {
  if (control instanceof HTMLButtonElement) control.disabled = busy;
  control?.toggleAttribute('aria-busy', busy);
}

function getInput(root: ParentNode, selector: string): HTMLInputElement | null {
  return root.querySelector<HTMLInputElement>(selector);
}

function getButton(root: ParentNode, selector: string): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(selector);
}

function setText(element: HTMLElement | null, value: string): void {
  if (element) element.textContent = value;
}

function objectValue(value: DesktopJsonValue | undefined): DesktopJsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as DesktopJsonObject : null;
}

function arrayValue(value: DesktopJsonValue | undefined): readonly DesktopJsonValue[] | null {
  return Array.isArray(value) ? value : null;
}

function stringValue(value: DesktopJsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

interface ResultRow {
  readonly id: string;
  readonly name: string;
  readonly inn: string;
  readonly status: string;
  readonly risk: string;
  readonly source: string;
}
