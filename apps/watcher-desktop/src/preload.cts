import { contextBridge, ipcRenderer } from 'electron';
import type {
  AccessLoginRequest,
  DesktopConfigPackage,
  DesktopConnectionCheck,
  DesktopAccessState,
  DesktopModeSummary,
  DesktopUiState,
  DiagnosticsPreview,
  McpDiffPreview,
  ProjectDraft,
  ProjectImportResult,
  SavedProjectProfile,
  WatcherDesktopApi,
  WatcherServiceActionRequest,
  WatcherServiceActionResult,
  WatcherServiceStatus,
} from './contracts.js';

const api: WatcherDesktopApi = {
  access: {
    status: () => ipcRenderer.invoke('access:status') as Promise<DesktopAccessState>,
    login: (request: AccessLoginRequest) => (
      ipcRenderer.invoke('access:login', request) as Promise<DesktopAccessState>
    ),
  },
  ui: {
    loadState: () => ipcRenderer.invoke('ui:load-state') as Promise<DesktopUiState>,
    saveState: (state: DesktopUiState) => (
      ipcRenderer.invoke('ui:save-state', state) as Promise<DesktopUiState>
    ),
  },
  service: {
    status: () => ipcRenderer.invoke('service:status') as Promise<WatcherServiceStatus>,
    run: (request: WatcherServiceActionRequest) => (
      ipcRenderer.invoke('service:run', request) as Promise<WatcherServiceActionResult>
    ),
    fullCheck: (projectId: string) => (
      ipcRenderer.invoke('service:full-check', projectId) as Promise<DesktopConnectionCheck>
    ),
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list') as Promise<readonly SavedProjectProfile[]>,
    save: (project: ProjectDraft) => (
      ipcRenderer.invoke('projects:save', project) as Promise<SavedProjectProfile>
    ),
    selectRoot: () => ipcRenderer.invoke('projects:select-root') as Promise<string | null>,
    importConfig: () => (
      ipcRenderer.invoke('projects:import-config') as Promise<ProjectImportResult | null>
    ),
    buildConfigPackage: (projectId: string) => (
      ipcRenderer.invoke('projects:build-config-package', projectId) as Promise<DesktopConfigPackage>
    ),
    saveConfigPackage: (projectId: string) => (
      ipcRenderer.invoke('projects:save-config-package', projectId) as Promise<string | null>
    ),
  },
  mcp: {
    previewDiff: (client: McpDiffPreview['client']) => (
      ipcRenderer.invoke('mcp:preview-diff', client) as Promise<McpDiffPreview>
    ),
  },
  modes: {
    list: () => ipcRenderer.invoke('modes:list') as Promise<readonly DesktopModeSummary[]>,
  },
  diagnostics: {
    previewExport: () => (
      ipcRenderer.invoke('diagnostics:preview-export') as Promise<DiagnosticsPreview>
    ),
  },
};

contextBridge.exposeInMainWorld('watcherDesktop', api);
