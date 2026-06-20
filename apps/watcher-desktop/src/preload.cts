import { contextBridge, ipcRenderer } from 'electron';
import type {
  AccessLoginRequest,
  DesktopConfigPackage,
  DesktopConfigSaveResult,
  DesktopCodexGateStatus,
  DesktopConnectionCheck,
  DesktopAccessState,
  DesktopModeSummary,
  DesktopUiState,
  DiagnosticsPreview,
  ManagedDeviceEnrollment,
  ManagedDeviceStatus,
  McpDiffPreview,
  ProjectDraft,
  ProjectImportResult,
  SavedProjectProfile,
  WatcherDesktopApi,
  WatcherServiceActionRequest,
  WatcherServiceActionResult,
  WatcherServiceLogChunk,
  WatcherServiceStatus,
} from './contracts.js';

const api: WatcherDesktopApi = {
  access: {
    status: () => ipcRenderer.invoke('access:status') as Promise<DesktopAccessState>,
    login: (request: AccessLoginRequest) => (
      ipcRenderer.invoke('access:login', request) as Promise<DesktopAccessState>
    ),
    logout: () => ipcRenderer.invoke('access:logout') as Promise<DesktopAccessState>,
  },
  ui: {
    loadState: () => ipcRenderer.invoke('ui:load-state') as Promise<DesktopUiState>,
    saveState: (state: DesktopUiState) => (
      ipcRenderer.invoke('ui:save-state', state) as Promise<DesktopUiState>
    ),
  },
  service: {
    status: (projectId?: string) => ipcRenderer.invoke('service:status', projectId) as Promise<WatcherServiceStatus>,
    run: (request: WatcherServiceActionRequest) => (
      ipcRenderer.invoke('service:run', request) as Promise<WatcherServiceActionResult>
    ),
    fullCheck: (projectId: string) => (
      ipcRenderer.invoke('service:full-check', projectId) as Promise<DesktopConnectionCheck>
    ),
    logChunk: (projectId: string, cursorId: string) => (
      ipcRenderer.invoke('service:log-chunk', projectId, cursorId) as Promise<WatcherServiceLogChunk | null>
    ),
  },
  codexGates: {
    status: (projectId: string) => (
      ipcRenderer.invoke('codex-gates:status', projectId) as Promise<DesktopCodexGateStatus>
    ),
    verify: (projectId: string) => (
      ipcRenderer.invoke('codex-gates:verify', projectId) as Promise<DesktopCodexGateStatus>
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
      ipcRenderer.invoke('projects:save-config-package', projectId) as Promise<DesktopConfigSaveResult | null>
    ),
  },
  mcp: {
    previewDiff: (client: McpDiffPreview['client']) => (
      ipcRenderer.invoke('mcp:preview-diff', client) as Promise<McpDiffPreview>
    ),
  },
  modes: {
    list: (projectId?: string) => ipcRenderer.invoke('modes:list', projectId) as Promise<readonly DesktopModeSummary[]>,
  },
  diagnostics: {
    previewExport: (projectId?: string) => (
      ipcRenderer.invoke('diagnostics:preview-export', projectId) as Promise<DiagnosticsPreview>
    ),
  },
  support: {
    status: () => ipcRenderer.invoke('support:status') as Promise<ManagedDeviceStatus>,
    enroll: (projectId?: string) => (
      ipcRenderer.invoke('support:enroll', projectId) as Promise<ManagedDeviceEnrollment>
    ),
    collectDiagnostics: (projectId?: string) => (
      ipcRenderer.invoke('support:collect-diagnostics', projectId) as Promise<DiagnosticsPreview>
    ),
  },
  clipboard: {
    writeText: (value: string) => (
      ipcRenderer.invoke('clipboard:write-text', value) as Promise<void>
    ),
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize') as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize') as Promise<boolean>,
    close: () => ipcRenderer.invoke('window:close') as Promise<void>,
  },
};

contextBridge.exposeInMainWorld('watcherDesktop', api);
