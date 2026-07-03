import type { DesktopInfoIndexerToolResult } from './contracts.js';
import { errorMessage, setText } from './renderer-view.js';

declare global {
  interface Window {
    readonly watcherDesktop: import('./contracts.js').WatcherDesktopApi;
  }
}

export function setupInfoIndexerSection(options: Readonly<{
  getProjectId(): string;
  writeLog(value: string): void;
}>): void {
  const form = document.querySelector<HTMLFormElement>('[data-infoindexer-search-form]');
  const input = document.querySelector<HTMLInputElement>('[data-infoindexer-search-input]');
  const output = document.querySelector<HTMLElement>('[data-infoindexer-search-output]');
  const submit = document.querySelector<HTMLButtonElement>('[data-infoindexer-search-submit]');
  if (!form || !input || !output || !submit) return;

  form.addEventListener('submit', event => {
    event.preventDefault();
    void runInfoIndexerSearch({ input, output, submit, ...options });
  });
}

async function runInfoIndexerSearch(options: Readonly<{
  input: HTMLInputElement;
  output: HTMLElement;
  submit: HTMLButtonElement;
  getProjectId(): string;
  writeLog(value: string): void;
}>): Promise<void> {
  const projectId = options.getProjectId();
  const query = options.input.value.trim();
  if (!projectId) {
    setText(options.output, 'Выберите проект перед поиском InfoIndexer.');
    return;
  }
  if (!query) {
    setText(options.output, 'Введите ИНН, ОГРН или название организации.');
    return;
  }

  options.submit.disabled = true;
  setText(options.output, 'Идёт поиск InfoIndexer...');
  try {
    const result = await window.watcherDesktop.infoIndexer.searchCompanies({
      projectId,
      query,
      limit: 10,
      projection: 'compact',
    });
    setText(options.output, formatInfoIndexerSearchResult(result));
  } catch (error) {
    const message = errorMessage(error);
    setText(options.output, `Поиск InfoIndexer не завершился: ${message}`);
    options.writeLog(message);
  } finally {
    options.submit.disabled = false;
  }
}

function formatInfoIndexerSearchResult(result: DesktopInfoIndexerToolResult): string {
  const status = result.structuredContent?.status;
  const requiredNext = result.structuredContent?.required_next;
  const header = [
    `Статус: ${typeof status === 'string' ? status : result.ok ? 'ok' : 'failed'}`,
    `Инструмент: ${result.tool}`,
    requiredNext ? `Следующий шаг: ${String(requiredNext)}` : null,
  ].filter((value): value is string => Boolean(value));
  return `${header.join('\n')}\n\n${JSON.stringify(result.structuredContent ?? { content: result.content }, null, 2)}`;
}
