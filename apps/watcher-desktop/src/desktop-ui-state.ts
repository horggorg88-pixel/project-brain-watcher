import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesktopSection, DesktopTheme, DesktopUiState } from './contracts.js';
import type { DesktopCorePaths } from './desktop-profile-store.js';

const SECTIONS: readonly DesktopSection[] = ['start', 'mcp', 'prompt', 'watcher', 'projects', 'modes', 'diagnostics', 'settings'];
const THEMES: readonly DesktopTheme[] = ['light', 'dark'];

export function defaultDesktopUiState(): DesktopUiState {
  return {
    activeSection: 'start',
    theme: 'light',
    consoleOpen: true,
    lastProjectId: null,
    keyVisible: false,
  };
}

export function readDesktopUiState(paths: DesktopCorePaths): DesktopUiState {
  const path = uiStatePath(paths);
  if (!existsSync(path)) return defaultDesktopUiState();
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return normalizeUiState(parsed);
  } catch {
    return defaultDesktopUiState();
  }
}

export function saveDesktopUiState(paths: DesktopCorePaths, state: DesktopUiState): DesktopUiState {
  const normalized = normalizeUiState(state);
  mkdirSync(paths.userDataPath, { recursive: true });
  writeFileSync(uiStatePath(paths), JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

function uiStatePath(paths: DesktopCorePaths): string {
  return join(paths.userDataPath, 'desktop-ui-state.json');
}

function normalizeUiState(value: unknown): DesktopUiState {
  if (!isRecord(value)) return defaultDesktopUiState();
  return {
    activeSection: readSection(value.activeSection),
    theme: readTheme(value.theme),
    consoleOpen: typeof value.consoleOpen === 'boolean' ? value.consoleOpen : true,
    lastProjectId: typeof value.lastProjectId === 'string' && value.lastProjectId.trim() ? value.lastProjectId.trim() : null,
    keyVisible: typeof value.keyVisible === 'boolean' ? value.keyVisible : false,
  };
}

function readSection(value: unknown): DesktopSection {
  return typeof value === 'string' && SECTIONS.includes(value as DesktopSection) ? value as DesktopSection : 'start';
}

function readTheme(value: unknown): DesktopTheme {
  return typeof value === 'string' && THEMES.includes(value as DesktopTheme) ? value as DesktopTheme : 'light';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
