import type { WatcherCommandStatus } from './contracts.js';

export function serviceCommandStatusLine(status: WatcherCommandStatus): string {
  const base = `Команда: ${status.label}, ${status.durationMs} мс`;
  if (status.status === 'timed_out') {
    const killState = status.killed ? 'процесс остановлен' : 'остановка не подтверждена';
    return `${base}, таймаут ${status.timeoutMs ?? 'нет'} мс, ${killState}`;
  }
  if (status.status === 'spawn_error') return `${base}, не запустилась: ${status.errorMessage ?? status.errorCode ?? 'ошибка запуска'}`;
  if (status.status === 'killed') return `${base}, завершена сигналом ${status.signal ?? 'unknown'}`;
  return `${base}, exitCode=${status.exitCode ?? 'нет'}`;
}
