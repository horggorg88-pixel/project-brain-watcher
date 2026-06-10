import { describe, expect, it } from 'vitest';
import {
  resolveServiceActionConfirmation,
  type PendingServiceActionConfirmation,
} from '../../apps/watcher-desktop/src/renderer-service-ui.js';

describe('watcher desktop service UI confirmation', () => {
  it('prompts inline on the first mutating service action click', () => {
    const decision = resolveServiceActionConfirmation({
      action: 'start',
      confirmAction: true,
      nowMs: 1_000,
      pending: null,
      projectId: 'demo',
    });

    expect(decision.confirmed).toBe(false);
    expect(decision.pending).toEqual({ action: 'start', projectId: 'demo', expiresAt: 16_000 });
    expect(decision.message).toContain('нажмите эту же кнопку ещё раз');
  });

  it('confirms the second click for the same action and project before expiry', () => {
    const pending: PendingServiceActionConfirmation = { action: 'restart', projectId: 'demo', expiresAt: 20_000 };

    const decision = resolveServiceActionConfirmation({
      action: 'restart',
      confirmAction: true,
      nowMs: 12_000,
      pending,
      projectId: 'demo',
    });

    expect(decision.confirmed).toBe(true);
    expect(decision.pending).toBeNull();
    expect(decision.message).toBeNull();
  });

  it('does not confirm expired or different project actions', () => {
    const pending: PendingServiceActionConfirmation = { action: 'stop', projectId: 'demo', expiresAt: 20_000 };

    const expired = resolveServiceActionConfirmation({
      action: 'stop',
      confirmAction: true,
      nowMs: 20_001,
      pending,
      projectId: 'demo',
    });
    const differentProject = resolveServiceActionConfirmation({
      action: 'stop',
      confirmAction: true,
      nowMs: 12_000,
      pending,
      projectId: 'other',
    });

    expect(expired.confirmed).toBe(false);
    expect(differentProject.confirmed).toBe(false);
    expect(expired.pending?.projectId).toBe('demo');
    expect(differentProject.pending?.projectId).toBe('other');
  });

  it('allows health checks without a confirmation rail', () => {
    const pending: PendingServiceActionConfirmation = { action: 'start', projectId: 'demo', expiresAt: 20_000 };

    const decision = resolveServiceActionConfirmation({
      action: 'health',
      confirmAction: false,
      nowMs: 12_000,
      pending,
      projectId: 'demo',
    });

    expect(decision.confirmed).toBe(true);
    expect(decision.pending).toBeNull();
    expect(decision.message).toBeNull();
  });

  it('requires a same-action second click for every mutating service action', () => {
    const actions = ['install', 'start', 'stop', 'restart'] as const;

    for (const action of actions) {
      const firstClick = resolveServiceActionConfirmation({
        action,
        confirmAction: true,
        nowMs: 1_000,
        pending: null,
        projectId: 'demo',
      });
      const secondClick = resolveServiceActionConfirmation({
        action,
        confirmAction: true,
        nowMs: 2_000,
        pending: firstClick.pending,
        projectId: 'demo',
      });

      expect(firstClick.confirmed).toBe(false);
      expect(firstClick.pending).toEqual({ action, projectId: 'demo', expiresAt: 16_000 });
      expect(firstClick.message).toContain('нажмите эту же кнопку ещё раз');
      expect(secondClick.confirmed).toBe(true);
      expect(secondClick.pending).toBeNull();
    }
  });
});
