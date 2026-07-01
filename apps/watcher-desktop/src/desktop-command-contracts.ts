export type DesktopCommandSurface = 'electron' | 'mcp' | 'cli' | 'remote';
export type DesktopCommandCategory =
  | 'watcher_service'
  | 'codex_gates'
  | 'mcp_config'
  | 'remote_support'
  | 'updater'
  | 'diagnostics';
export type DesktopCommandRisk = 'low' | 'medium' | 'high';
export type DesktopCommandStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'waiting'
  | 'stale'
  | 'unavailable'
  | 'timed_out'
  | 'cancelled';
export type DesktopCommandAckState =
  | 'local_committed'
  | 'server_pending'
  | 'server_acknowledged'
  | 'server_failed';

export type DesktopCommandId =
  | 'watcher.health'
  | 'watcher.install'
  | 'watcher.start'
  | 'watcher.stop'
  | 'watcher.restart'
  | 'watcher.check_update'
  | 'watcher.update'
  | 'codex.verify_gates'
  | 'mcp.refresh_config'
  | 'diagnostics.collect'
  | 'support.collect_diagnostics'
  | 'support.repair_watcher_service'
  | 'support.restart_watcher'
  | 'support.update_watcher'
  | 'support.verify_codex_gates'
  | 'support.refresh_mcp_config'
  | 'support.mesh_status';

export type DesktopCommandProgressStepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export interface DesktopCommandDescriptor {
  readonly id: DesktopCommandId;
  readonly label: string;
  readonly globalActionId: string;
  readonly category: DesktopCommandCategory;
  readonly surface: DesktopCommandSurface;
  readonly risk: DesktopCommandRisk;
  readonly destructive: boolean;
  readonly timeoutMs: number | null;
  readonly requiredEvidence: readonly string[];
  readonly progressSteps: readonly string[];
  readonly progressText: DesktopCommandProgressText;
}

export interface DesktopCommandProgressText {
  readonly labels: Readonly<Record<string, string>>;
  readonly finalLog: string;
}

export interface DesktopCommandProgressStep {
  readonly id: string;
  readonly label: string;
  readonly status: DesktopCommandProgressStepStatus;
  readonly detail: string;
}

export interface DesktopCommandDiagnostic {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly title: string;
  readonly detail: string;
  readonly nextAction: string;
  readonly evidenceRefs: readonly string[];
}

export interface DesktopCommandReceipt {
  readonly version: 'desktop-command-receipt/v1';
  readonly receiptId: string;
  readonly runId: string;
  readonly commandId: DesktopCommandId;
  readonly projectId: string;
  readonly surface: DesktopCommandSurface;
  readonly category: DesktopCommandCategory;
  readonly status: DesktopCommandStatus;
  readonly risk: DesktopCommandRisk;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly elapsedMs: number | null;
  readonly ackState: DesktopCommandAckState;
  readonly logCursor: string | null;
  readonly diagnostic: DesktopCommandDiagnostic | null;
  readonly steps: readonly DesktopCommandProgressStep[];
}
