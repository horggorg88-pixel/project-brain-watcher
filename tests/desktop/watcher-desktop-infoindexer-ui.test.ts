import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopInfoIndexerToolResult } from '../../apps/watcher-desktop/src/contracts.js';
import { setupInfoIndexerSection } from '../../apps/watcher-desktop/src/renderer-infoindexer-ui.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('watcher desktop InfoIndexer renderer UI', () => {
  it('submits search through the typed bridge and restores the submit button', async () => {
    const result: DesktopInfoIndexerToolResult = {
      ok: true,
      content: 'search ok',
      structuredContent: { status: 'ok', project_id: 'infoindexer', required_next: null },
      isError: false,
      status: 200,
      cacheControl: 'no-store',
      endpoint: 'http://127.0.0.1:14900/api/tools/call',
      projectId: 'infoindexer',
      tool: 'infoindexer.search_companies',
    };
    const searchCompanies = vi.fn(async () => result);
    const form = installInfoIndexerDom(searchCompanies);

    setupInfoIndexerSection({ getProjectId: () => 'infoindexer', writeLog: vi.fn() });
    form.input.value = '  ООО Ромашка  ';
    form.submit();
    await flushPromises();

    expect(searchCompanies).toHaveBeenCalledWith({
      projectId: 'infoindexer',
      query: 'ООО Ромашка',
      limit: 10,
      projection: 'compact',
    });
    expect(form.output.textContent).toContain('Статус: ok');
    expect(form.output.textContent).toContain('"project_id": "infoindexer"');
    expect(form.submitButton.disabled).toBe(false);
  });

  it('blocks empty project and empty query without calling the bridge', async () => {
    const searchCompanies = vi.fn(async (): Promise<DesktopInfoIndexerToolResult> => {
      throw new Error('unexpected bridge call');
    });
    const form = installInfoIndexerDom(searchCompanies);

    setupInfoIndexerSection({ getProjectId: () => '', writeLog: vi.fn() });
    form.input.value = 'ООО Ромашка';
    form.submit();
    await flushPromises();

    expect(searchCompanies).not.toHaveBeenCalled();
    expect(form.output.textContent).toBe('Выберите проект перед поиском InfoIndexer.');

    setupInfoIndexerSection({ getProjectId: () => 'infoindexer', writeLog: vi.fn() });
    form.input.value = '   ';
    form.submit();
    await flushPromises();

    expect(searchCompanies).not.toHaveBeenCalled();
    expect(form.output.textContent).toBe('Введите ИНН, ОГРН или название организации.');
  });

  it('surfaces bridge errors and restores the submit button', async () => {
    const searchCompanies = vi.fn(async (): Promise<DesktopInfoIndexerToolResult> => {
      throw new Error('bridge failed');
    });
    const writeLog = vi.fn();
    const form = installInfoIndexerDom(searchCompanies);

    setupInfoIndexerSection({ getProjectId: () => 'infoindexer', writeLog });
    form.input.value = 'ООО Ромашка';
    form.submit();
    await flushPromises();

    expect(form.output.textContent).toContain('Поиск InfoIndexer не завершился');
    expect(writeLog).toHaveBeenCalledWith('bridge failed');
    expect(form.submitButton.disabled).toBe(false);
  });
});

function installInfoIndexerDom(searchCompanies: (request: {
  readonly projectId: string;
  readonly query: string;
  readonly limit: number;
  readonly projection: 'compact';
}) => Promise<DesktopInfoIndexerToolResult>): {
  readonly input: { value: string };
  readonly output: { textContent: string };
  readonly submitButton: { disabled: boolean };
  submit(): void;
} {
  let submitHandler: ((event: Event) => void) | null = null;
  const form = {
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject): void => {
      if (type === 'submit' && typeof listener === 'function') submitHandler = listener;
    },
  };
  const input = { value: '' };
  const output = { textContent: '' };
  const submitButton = { disabled: false };
  const elements = new Map<string, object>([
    ['[data-infoindexer-search-form]', form],
    ['[data-infoindexer-search-input]', input],
    ['[data-infoindexer-search-output]', output],
    ['[data-infoindexer-search-submit]', submitButton],
  ]);
  vi.stubGlobal('document', {
    querySelector: <T extends Element = Element>(selector: string): T | null => {
      const element = elements.get(selector);
      return element === undefined ? null : element as T;
    },
  });
  vi.stubGlobal('window', { watcherDesktop: { infoIndexer: { searchCompanies } } });
  return {
    input,
    output,
    submitButton,
    submit: () => {
      expect(submitHandler).not.toBeNull();
      submitHandler?.(new Event('submit'));
    },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
