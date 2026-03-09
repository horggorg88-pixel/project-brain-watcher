#!/usr/bin/env node
/**
 * Wrapper для запуска watcher.js через node.
 * Решает проблему Windows, когда .js ассоциирован с Блокнотом — npx открывает файл вместо выполнения.
 * Явный spawn через process.execPath гарантирует запуск в терминале на всех платформах.
 */
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watcherPath = join(__dirname, 'watcher.js');
const result = spawnSync(process.execPath, [watcherPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: false,
});
process.exit(result.status ?? (result.signal ? 1 : 0));
