import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  allDesktopCommandDescriptors,
  desktopCheckActionCommandId,
  descriptorForCommand,
  SUPPORT_COMMAND_IDS,
  WATCHER_SERVICE_COMMAND_IDS,
} from '../../apps/watcher-desktop/src/desktop-command-registry.js';
import type { DesktopCommandId } from '../../apps/watcher-desktop/src/desktop-command-contracts.js';
import type { DesktopCheckAction, WatcherServiceAction } from '../../apps/watcher-desktop/src/contracts.js';

const STANDALONE_COMMAND_IDS = [
  'codex.verify_gates',
  'mcp.refresh_config',
  'diagnostics.collect',
] as const satisfies readonly DesktopCommandId[];

const EXPECTED_COMMAND_IDS = [
  ...Object.values(WATCHER_SERVICE_COMMAND_IDS),
  ...Object.values(SUPPORT_COMMAND_IDS),
  ...STANDALONE_COMMAND_IDS,
] as const satisfies readonly DesktopCommandId[];

const EXPECTED_PROGRESS_STEPS = {
  'watcher.install': [
    'preflight',
    'runtime_download',
    'runtime_install',
    'service_install',
    'launcher_verify',
    'service_start',
    'health',
  ],
  'watcher.start': ['preflight', 'service_start', 'health', 'diagnostics'],
  'watcher.stop': ['preflight', 'service_stop', 'status_verify', 'diagnostics'],
  'watcher.restart': [
    'preflight',
    'service_stop',
    'service_start',
    'health',
    'diagnostics',
  ],
  'watcher.check_update': ['preflight', 'github_release', 'compare_versions'],
  'watcher.update': [
    'preflight',
    'download',
    'verify',
    'install',
    'runtime_install',
    'restart',
    'health',
  ],
} as const satisfies Partial<Record<DesktopCommandId, readonly string[]>>;

describe('watcher desktop command registry', () => {
  it('has exact descriptor coverage for every registered desktop command', () => {
    const descriptors = allDesktopCommandDescriptors();
    const descriptorIds = descriptors.map(descriptor => descriptor.id);

    expect(new Set(descriptorIds)).toEqual(new Set(EXPECTED_COMMAND_IDS));
    expect(descriptorIds).toHaveLength(EXPECTED_COMMAND_IDS.length);

    for (const commandId of EXPECTED_COMMAND_IDS) {
      expect(descriptorForCommand(commandId).id).toBe(commandId);
    }
  });

  it('requires positive timeouts plus non-empty evidence and progress steps', () => {
    for (const descriptor of allDesktopCommandDescriptors()) {
      expect(descriptor.globalActionId).toMatch(/^desktop:/);
      expect(descriptor.timeoutMs).toBeGreaterThan(0);
      expect(descriptor.requiredEvidence.length).toBeGreaterThan(0);
      expect(descriptor.progressSteps.length).toBeGreaterThan(0);
      expect(descriptor.progressText.finalLog.trim()).not.toHaveLength(0);

      for (const evidence of descriptor.requiredEvidence) {
        expect(evidence.trim()).not.toHaveLength(0);
      }

      for (const step of descriptor.progressSteps) {
        expect(step.trim()).not.toHaveLength(0);
        const stepLabel = descriptor.progressText.labels[step] ?? '';
        expect(stepLabel.trim()).not.toHaveLength(0);
      }
    }
  });

  it('uses command-specific progress steps for service runtime commands', () => {
    for (const [commandId, expectedSteps] of Object.entries(EXPECTED_PROGRESS_STEPS)) {
      expect(descriptorForCommand(commandId as DesktopCommandId).progressSteps).toEqual(expectedSteps);
    }
  });

  it('maps every service button in the desktop shell to a command descriptor', () => {
    const html = readFileSync(resolve('apps/watcher-desktop/src/index.html'), 'utf-8');
    const actions = [...html.matchAll(/data-service-action="([^"]+)"/g)]
      .map(match => match[1] as WatcherServiceAction);

    expect(actions).toEqual(expect.arrayContaining(Object.keys(WATCHER_SERVICE_COMMAND_IDS)));
    for (const action of actions) {
      expect(descriptorForCommand(WATCHER_SERVICE_COMMAND_IDS[action]).id).toBe(WATCHER_SERVICE_COMMAND_IDS[action]);
    }
  });

  it('maps command-producing checklist actions to descriptors', () => {
    const commandActions: readonly DesktopCheckAction[] = [
      'install_service',
      'start_service',
      'verify_codex_gates',
      'verify',
    ];

    for (const action of commandActions) {
      const commandId = desktopCheckActionCommandId(action);
      expect(commandId).not.toBeNull();
      expect(descriptorForCommand(commandId as DesktopCommandId).id).toBe(commandId);
    }
  });
});
