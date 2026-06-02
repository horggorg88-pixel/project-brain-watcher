export type WatcherHealth = 'not_configured' | 'healthy' | 'degraded' | 'stopped' | 'read_only';
export type WatcherServiceAction = 'health' | 'install' | 'start' | 'stop' | 'restart';
export type WatcherPolicyDecision = 'allow' | 'prompt' | 'deny';
export type WatcherPolicyRisk = 'low' | 'medium' | 'high';
export type McpConfigSource = 'codex' | 'claude' | 'cursor' | 'generic' | 'none';
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
}

export interface ProjectDraft {
  readonly id: string;
  readonly name: string;
  readonly root: string;
  readonly indexId: string;
  readonly serverUrl: string;
  readonly tokenEnv: string;
}

export interface SavedProjectProfile extends ProjectDraft {
  readonly createdAt: string;
}

export interface ProjectImportResult {
  readonly profile: SavedProjectProfile;
  readonly sourcePath: string;
  readonly warnings: readonly string[];
  readonly tokenDetected: boolean;
  readonly secretStaged: boolean;
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

export interface WatcherDesktopApi {
  readonly access: {
    status(): Promise<DesktopAccessState>;
    login(request: AccessLoginRequest): Promise<DesktopAccessState>;
  };
  readonly service: {
    status(): Promise<WatcherServiceStatus>;
    run(request: WatcherServiceActionRequest): Promise<WatcherServiceActionResult>;
  };
  readonly projects: {
    list(): Promise<readonly SavedProjectProfile[]>;
    save(project: ProjectDraft): Promise<SavedProjectProfile>;
    selectRoot(): Promise<string | null>;
    importConfig(): Promise<ProjectImportResult | null>;
  };
  readonly mcp: {
    previewDiff(client: McpDiffPreview['client']): Promise<McpDiffPreview>;
  };
  readonly diagnostics: {
    previewExport(): Promise<DiagnosticsPreview>;
  };
}
