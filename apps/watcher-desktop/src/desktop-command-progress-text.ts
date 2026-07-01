import type { DesktopCommandId, DesktopCommandProgressText } from './desktop-command-contracts.js';

export const DESKTOP_COMMAND_PROGRESS_TEXT: Readonly<Record<DesktopCommandId, DesktopCommandProgressText>> = {
  'watcher.health': commandText({
    preflight: 'Проверяем выбранный проект, bearer и MCP-доступ',
    service_status: 'Запрашиваем состояние Windows-службы watcher',
    logs: 'Читаем последние watcher/service логи',
    diagnostics: 'Собираем последние логи и понятную причину статуса',
  }, 'доступ к MCP-серверу, состояние службы и последние логи'),
  'watcher.install': commandText({
    preflight: 'Проверяем выбранный проект, bearer и MCP-доступ',
    runtime_download: 'Скачиваем локальный watcher runtime из release package',
    runtime_install: 'Ставим локальный watcher runtime в .brain/service',
    service_install: 'Устанавливаем или обновляем Windows-службу watcher',
    launcher_verify: 'Проверяем launcher, XML и WinSW wrapper',
    service_start: 'Запускаем Windows-службу watcher после установки',
    health: 'Проверяем, что служба может перейти в healthy',
  }, 'что установлено, где лежит launcher/XML и почему служба готова или не готова'),
  'watcher.start': commandText({
    preflight: 'Проверяем выбранный проект, bearer и MCP-доступ',
    service_start: 'Запускаем Windows-службу watcher',
    health: 'Ждём healthy, lease и первую синхронизацию',
    diagnostics: 'Собираем логи запуска и первопричину, если healthy не наступил',
  }, 'запущена ли служба, получен ли lease и прошла ли первая синхронизация'),
  'watcher.stop': commandText({
    preflight: 'Проверяем выбранный проект и текущий профиль службы',
    service_stop: 'Останавливаем Windows-службу watcher',
    status_verify: 'Проверяем, что служба действительно остановлена',
    diagnostics: 'Собираем логи остановки и итоговый статус',
  }, 'остановлена ли служба и какой код вернул WinSW'),
  'watcher.restart': commandText({
    preflight: 'Проверяем выбранный проект, bearer и MCP-доступ',
    service_stop: 'Останавливаем текущий процесс Windows-службы watcher',
    service_start: 'Запускаем Windows-службу watcher заново',
    health: 'Ждём healthy, lease и первую синхронизацию после перезапуска',
    diagnostics: 'Собираем логи перезапуска и первопричину, если healthy не наступил',
  }, 'перезапустилась ли служба и вернулась ли она в healthy'),
  'watcher.check_update': commandText({
    preflight: 'Проверяем текущую версию пульта и watcher',
    github_release: 'Запрашиваем последний GitHub release',
    compare_versions: 'Сравниваем версии и формируем решение об обновлении',
  }, 'есть ли новая версия, какая версия локально и какая доступна в GitHub release'),
  'watcher.update': commandText({
    preflight: 'Проверяем текущую версию, профиль проекта и доступ к release',
    download: 'Скачиваем desktop installer и проверяем checksum',
    verify: 'Проверяем подпись, размер и целостность скачанного release',
    install: 'Запускаем установку desktop update',
    runtime_install: 'Ставим локальный watcher runtime из release package',
    restart: 'Перезапускаем Windows-службу на новой версии',
    health: 'Сверяем версии, healthy и итоговый статус службы',
  }, 'что скачано, что установлено и какой статус службы после обновления'),
  'codex.verify_gates': commandText({
    preflight: 'Проверяем Codex CLI, trust и выбранный проект',
    hooks: 'Проверяем persistent-verifier hooks и managed requirements',
    quality_gates: 'Собираем rails typecheck, lint, test, build, check и verify',
    runtime_context: 'Проверяем native Runtime Context evidence',
    diagnostics: 'Собираем причину, если Codex gates не готовы',
  }, 'какие Codex hooks и quality rails готовы, а какие требуют действия'),
  'mcp.refresh_config': commandText({
    preflight: 'Проверяем выбранный проект, bearer и профиль MCP',
    write_config: 'Обновляем MCP config выбранного проекта',
    verify_access: 'Проверяем доступ MCP-сервера по новому config',
    diagnostics: 'Собираем причину, если config не применился',
  }, 'куда записан MCP config и подтвердил ли сервер доступ'),
  'diagnostics.collect': commandText({
    preflight: 'Проверяем выбранный проект и доступные логи',
    collect: 'Собираем status, logs, gates и receipts',
    redact: 'Редактируем токены и приватные значения',
    diagnostics: 'Формируем AI-readable diagnostic envelope',
  }, 'какие логи и evidence собраны для диагностики'),
  'support.collect_diagnostics': supportText('какая диагностика отправлена в support job'),
  'support.repair_watcher_service': supportText('как завершился ремонт watcher-службы'),
  'support.restart_watcher': supportText('как завершился удалённый restart watcher'),
  'support.update_watcher': supportText('как завершилось удалённое обновление watcher'),
  'support.verify_codex_gates': supportText('какой статус Codex gates вернул удалённый job'),
  'support.refresh_mcp_config': supportText('как завершилось удалённое обновление MCP config'),
  'support.mesh_status': supportText('какой mesh-status вернул удалённый job'),
};

function commandText(
  labels: Readonly<Record<string, string>>,
  finalLog: string,
): DesktopCommandProgressText {
  return { labels, finalLog };
}

function supportText(finalLog: string): DesktopCommandProgressText {
  return commandText({
    claim: 'Получаем support job и фиксируем ownership',
    progress: 'Отправляем progress events в админку',
    execute: 'Выполняем локальную команду support job',
    complete: 'Отправляем финальный receipt на сервер',
  }, finalLog);
}
