import type { DesktopConnectionCheck } from './contracts.js';
import { buildDesktopConnectionCheck } from './desktop-connection-check.js';
import {
  reportDesktopOnboardingProgress,
  type OnboardingEventReportResult,
} from './desktop-onboarding-events.js';
import type { DesktopCorePaths } from './desktop-profile-store.js';

export interface DesktopOnboardingSyncResult {
  readonly check: DesktopConnectionCheck;
  readonly reports: readonly OnboardingEventReportResult[];
}

export async function syncDesktopOnboardingProgress(
  paths: DesktopCorePaths,
  projectId: string,
): Promise<DesktopOnboardingSyncResult> {
  const check = await buildDesktopConnectionCheck(paths, projectId);
  const reports = await reportDesktopOnboardingProgress(paths, projectId, check);
  return { check, reports };
}
