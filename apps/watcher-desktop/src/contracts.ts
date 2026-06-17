export type WatcherHealth = 'not_configured' | 'healthy' | 'degraded' | 'stopped' | 'read_only';
export type WatcherServiceAction = 'health' | 'install' | 'start' | 'stop' | 'restart' | 'check_update' | 'update';
export type WatcherPolicyDecision = 'allow' | 'prompt' | 'deny';
export type WatcherPolicyRisk = 'low' | 'medium' | 'high';
export type McpConfigSource = 'codex' | 'claude' | 'cursor' | 'generic' | 'none';
export type DesktopTheme = 'light' | 'dark';
export type DesktopSection = 'start' | 'prompt' | 'watcher' | 'projects' | 'modes';
export type DesktopOverallStatus = 'ready' | 'action_required' | 'error';
export type DesktopCheckStatus = 'active' | 'inactive' | 'waiting' | 'error';
export type DesktopCheckAction =
  | 'none'
  | 'select_project'
  | 'import_config'
  | 'download_config'
  | 'install_service'
  | 'start_service'
  | 'open_logs'
  | 'verify_codex_gates'
  | 'verify';
export type DesktopModeStatus = 'ready' | 'action_required' | 'error';
export type AccessStatus =
  | 'signed_out'
  | 'config_missing'
  | 'secret_missing'
  | 'acl_failed'
  | 'bearer_unverified'
  | 'server_pending'
  | 'local_ready';

export interface SecretAclHealth {
  readonly restricted: boolean;
  readonly reason: string | null;
  readonly repairHint: string | null;
}

export interface WatcherServiceStatus {
  readonly installed: boolean;
  readonly running: boolean;
  readonly readOnly: boolean;
  readonly health: WatcherHealth;
  readonly projectId: string | null;
  readonly root: string | null;
  readonly pid: number | null;
  readonly queueDepth: number;
  readonly lastSyncAt: string | null;
  readonly lastError: string | null;
  readonly logs: WatcherServiceLogTail | null;
}

export interface WatcherServiceLogTail {
  readonly wrapperPath: string;
  readonly outPath: string;
  readonly errPath: string;
  readonly wrapper: string;
  readonly out: string;
  readonly err: string;
}

export interface ProjectDraft {
  readonly id: string;
  readonly name: string;
  readonly root: string;
  readonly indexId: string;
  readonly serverUrl: string;
  readonly consoleUrl?: string;
  readonly tokenEnv: string;
}

export interface SavedProjectProfile extends ProjectDraft {
  readonly createdAt: string;
}

export interface ProjectImportResult {
  readonly profile: SavedProjectProfile | null;
  readonly sourcePath: string;
  readonly warnings: readonly string[];
  readonly tokenDetected: boolean;
  readonly secretStaged: boolean;
  readonly accessConfigImported: boolean;
}

export interface McpDiffPreview {
  readonly client: 'codex' | 'claude' | 'cursor' | 'generic';
  readonly configPath: string;
  readonly backupRequired: boolean;
  readonly changes: readonly string[];
}

export interface DiagnosticsPreview {
  readonly blocked: boolean;
  readonly requiresSecretConfirmation: boolean;
  readonly readiness: WatcherPolicyDecision;
  readonly findings: readonly string[];
  readonly included: readonly string[];
  readonly secretWarnings: readonly string[];
  readonly checks: readonly WatcherPolicyGate[];
}

export interface McpConfigDiscovery {
  readonly found: boolean;
  readonly source: McpConfigSource;
  readonly configPath: string | null;
  readonly serverUrl: string | null;
  readonly consoleUrl: string | null;
  readonly tokenEnv: string | null;
  readonly projectId: string | null;
  readonly localPath: string | null;
  readonly findings: readonly string[];
}

export interface AccessLoginRequest {
  readonly email: string;
  readonly password: string;
}

export interface DesktopAccessState {
  readonly status: AccessStatus;
  readonly signedIn: boolean;
  readonly serverVerified: boolean;
  readonly serviceSecretConfigured: boolean;
  readonly email: string | null;
  readonly message: string;
  readonly config: McpConfigDiscovery;
  readonly gates: readonly WatcherPolicyGate[];
}

export interface WatcherPolicyGate {
  readonly decision: WatcherPolicyDecision;
  readonly risk: WatcherPolicyRisk;
  readonly reasons: readonly string[];
}

export interface WatcherServiceActionRequest {
  readonly action: WatcherServiceAction;
  readonly projectId: string;
  readonly confirmed: boolean;
}

export interface WatcherServiceActionResult {
  readonly executed: boolean;
  readonly policy: WatcherPolicyGate;
  readonly status: WatcherServiceStatus;
  readonly exitCode: number | null;
  readonly output: string;
}

export interface DesktopUiState {
  readonly activeSection: DesktopSection;
  readonly theme: DesktopTheme;
  readonly consoleOpen: boolean;
  readonly lastProjectId: string | null;
  readonly keyVisible: boolean;
}

export interface DesktopCheckNode {
  readonly id: string;
  readonly label: string;
  readonly status: DesktopCheckStatus;
  readonly detail: string;
  readonly action: DesktopCheckAction;
  readonly actionLabel: string | null;
}

export interface DesktopCodexGateRunEvidence {
  readonly available: boolean;
  readonly passed?: boolean;
  readonly detail: string;
  readonly checkedAt?: string;
  readonly staleAfterMs?: number;
  readonly source: string;
  readonly command: string;
  readonly exitCode?: number;
  readonly runId?: string;
}

export interface DesktopMcpIndexSnapshot {
  readonly files: number;
  readonly symbols: number;
  readonly embeddings: number;
  readonly checkedAt: string;
  readonly staleAfterMs: number;
  readonly source: string;
}

export type DesktopCodexCommandRunId =
  | 'typecheck'
  | 'lint'
  | 'format'
  | 'test'
  | 'coverage'
  | 'e2e'
  | 'build'
  | 'noAny'
  | 'securityScan'
  | 'dependencyAudit'
  | 'codexHooks';

export interface DesktopCodexGateEvidence {
  readonly commandRuns: Partial<Record<DesktopCodexCommandRunId, DesktopCodexGateRunEvidence>>;
  readonly verification: {
    readonly codexTrust?: DesktopCodexGateRunEvidence;
    readonly codexRuntime?: DesktopCodexGateRunEvidence;
    readonly desktopBootstrap?: DesktopCodexGateRunEvidence;
    readonly managedHooks?: DesktopCodexGateRunEvidence;
    readonly hookPersistence?: DesktopCodexGateRunEvidence;
    readonly runtimeContext?: DesktopCodexGateRunEvidence;
    readonly smoke?: DesktopCodexGateRunEvidence;
    readonly rollback?: DesktopCodexGateRunEvidence;
  };
}

export interface DesktopCodexGateStatus {
  readonly ready: boolean;
  readonly message: string;
  readonly checkedAt: string;
  readonly evidence: DesktopCodexGateEvidence;
}

export interface DesktopConnectionCheck {
  readonly overall: DesktopOverallStatus;
  readonly message: string;
  readonly projectId: string | null;
  readonly checkedAt: string;
  readonly nodes: readonly DesktopCheckNode[];
  readonly codexGates: DesktopCodexGateStatus;
  readonly mcpIndex?: DesktopMcpIndexSnapshot | null;
  readonly service: WatcherServiceStatus;
  readonly diagnostics: DiagnosticsPreview;
}

export interface DesktopConfigPackage {
  readonly projectId: string;
  readonly fileName: string;
  readonly brainDir: string;
  readonly brainConfigPath: string;
  readonly brainMcpPath: string;
  readonly configJson: string;
  readonly prompt: string;
  readonly tokenEnv: string;
  readonly tokenAvailable: boolean;
  readonly tokenPreview: string;
  readonly tokenValue: string | null;
  readonly secretPath: string | null;
}

export interface DesktopConfigSaveResult {
  readonly packagePath: string;
  readonly brainDir: string;
  readonly brainConfigPath: string;
  readonly brainMcpPath: string;
}

export interface DesktopModeRailStage {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
  readonly detail: string;
}

export interface DesktopModeSummary {
  readonly id: string;
  readonly title: string;
  readonly technicalName: string;
  readonly group: string;
  readonly status: DesktopModeStatus;
  readonly summary: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly aliases?: readonly string[];
  readonly confusionGuard?: string;
  readonly useCases: readonly string[];
  readonly primaryAction: string;
  readonly rails: readonly DesktopModeRailStage[];
}

export interface WatcherDesktopApi {
  readonly access: {
    status(): Promise<DesktopAccessState>;
    login(request: AccessLoginRequest): Promise<DesktopAccessState>;
    logout(): Promise<DesktopAccessState>;
  };
  readonly ui: {
    loadState(): Promise<DesktopUiState>;
    saveState(state: DesktopUiState): Promise<DesktopUiState>;
  };
  readonly service: {
    status(projectId?: string): Promise<WatcherServiceStatus>;
    run(request: WatcherServiceActionRequest): Promise<WatcherServiceActionResult>;
    fullCheck(projectId: string): Promise<DesktopConnectionCheck>;
  };
  readonly codexGates: {
    status(projectId: string): Promise<DesktopCodexGateStatus>;
    verify(projectId: string): Promise<DesktopCodexGateStatus>;
  };
  readonly projects: {
    list(): Promise<readonly SavedProjectProfile[]>;
    save(project: ProjectDraft): Promise<SavedProjectProfile>;
    selectRoot(): Promise<string | null>;
    importConfig(): Promise<ProjectImportResult | null>;
    buildConfigPackage(projectId: string): Promise<DesktopConfigPackage>;
    saveConfigPackage(projectId: string): Promise<DesktopConfigSaveResult | null>;
  };
  readonly mcp: {
    previewDiff(client: McpDiffPreview['client']): Promise<McpDiffPreview>;
  };
  readonly modes: {
    list(projectId?: string): Promise<readonly DesktopModeSummary[]>;
  };
  readonly diagnostics: {
    previewExport(projectId?: string): Promise<DiagnosticsPreview>;
  };
  readonly clipboard: {
    writeText(value: string): Promise<void>;
  };
  readonly windowControls: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<boolean>;
    close(): Promise<void>;
  };
}
