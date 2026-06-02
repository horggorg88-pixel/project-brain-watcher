import { contextBridge, ipcRenderer } from 'electron';
import type {
  AccessLoginRequest,
  DesktopAccessState,
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
  service: {
    status: () => ipcRenderer.invoke('service:status') as Promise<WatcherServiceStatus>,
    run: (request: WatcherServiceActionRequest) => (
      ipcRenderer.invoke('service:run', request) as Promise<WatcherServiceActionResult>
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
  },
  mcp: {
    previewDiff: (client: McpDiffPreview['client']) => (
      ipcRenderer.invoke('mcp:preview-diff', client) as Promise<McpDiffPreview>
    ),
  },
  diagnostics: {
    previewExport: () => (
      ipcRenderer.invoke('diagnostics:preview-export') as Promise<DiagnosticsPreview>
    ),
  },
};

contextBridge.exposeInMainWorld('watcherDesktop', api);
