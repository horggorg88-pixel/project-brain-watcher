import { readFileSync } from 'node:fs';

export const WATCHER_RELEASE_REPO = 'horggorg88-pixel/project-brain-watcher';
export const DEFAULT_RELEASE_CHECK_TIMEOUT_MS = 8_000;
export const RELEASE_CHECK_TIMEOUT_ENV = 'PROJECT_BRAIN_RELEASE_CHECK_TIMEOUT_MS';

export interface ReleaseLaneVersion {
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly outdated: boolean;
}

export interface ReleaseVersionCheck {
  readonly latestVersion: string;
  readonly releaseUrl: string;
  readonly desktop: ReleaseLaneVersion;
  readonly watcher: ReleaseLaneVersion;
}

export interface BuildReleaseVersionCheckInput {
  readonly currentDesktopVersion: string;
  readonly currentWatcherVersion: string;
  readonly latestTagName: string;
  readonly releaseUrl: string;
}

export interface LatestReleaseInfo {
  readonly tagName: string;
  readonly releaseUrl: string;
}

export interface ReleaseFetchOptions {
  readonly timeoutMs?: number;
}

export type ReleaseFetch = (
  url: string,
  init?: RequestInit,
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;

export function normalizeReleaseVersion(value: string): string {
  return value.trim().replace(/^v/i, '');
}

export function buildReleaseVersionCheck(input: BuildReleaseVersionCheckInput): ReleaseVersionCheck {
  const latestVersion = normalizeReleaseVersion(input.latestTagName);
  return {
    latestVersion,
    releaseUrl: input.releaseUrl,
    desktop: lane(input.currentDesktopVersion, latestVersion),
    watcher: lane(input.currentWatcherVersion, latestVersion),
  };
}

export function formatReleaseVersionCheck(check: ReleaseVersionCheck): string {
  return [
    `GitHub release: ${check.latestVersion}`,
    formatLane('Пульт', check.desktop),
    formatLane('Watcher', check.watcher),
    `Release: ${check.releaseUrl}`,
  ].join('\n');
}

export async function fetchLatestReleaseInfo(
  fetcher: ReleaseFetch = fetch,
  options: ReleaseFetchOptions = {},
): Promise<LatestReleaseInfo> {
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs ?? releaseCheckTimeoutMs());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`https://api.github.com/repos/${WATCHER_RELEASE_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub release недоступен: HTTP ${response.status}`);
    const payload = await response.json();
    const tagName = field(payload, 'tag_name');
    if (!tagName) throw new Error('GitHub release не вернул tag_name');
    return {
      tagName,
      releaseUrl: field(payload, 'html_url') ?? `https://github.com/${WATCHER_RELEASE_REPO}/releases/tag/${tagName}`,
    };
  } catch (error) {
    if (controller.signal.aborted && isAbortError(error)) {
      throw new Error(`GitHub release timeout after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchReleaseVersionCheck(
  currentDesktopVersion: string,
  currentWatcherVersion: string,
  fetcher: ReleaseFetch = fetch,
  options: ReleaseFetchOptions = {},
): Promise<ReleaseVersionCheck> {
  const latest = await fetchLatestReleaseInfo(fetcher, options);
  return buildReleaseVersionCheck({
    currentDesktopVersion,
    currentWatcherVersion,
    latestTagName: latest.tagName,
    releaseUrl: latest.releaseUrl,
  });
}

export function readLocalDesktopVersion(): string {
  const packageUrl = new URL('../package.json', import.meta.url);
  const payload = JSON.parse(readFileSync(packageUrl, 'utf-8')) as unknown;
  const version = field(payload, 'version');
  if (!version) throw new Error('Версия пульта не найдена в package.json');
  return version;
}

export function watcherPackageVersion(packageSpec: string): string {
  const normalizedSpec = packageSpec.trim();
  const hashMatch = /#v?([^#\s]+)$/.exec(normalizedSpec);
  if (hashMatch) return normalizeReleaseVersion(hashMatch[1] ?? '');
  const tarballMatch = /project-brain-watcher-v?([^/\s]+)\.tgz(?:[?#].*)?$/i.exec(normalizedSpec);
  if (tarballMatch) return normalizeReleaseVersion(tarballMatch[1] ?? '');
  throw new Error(`Версия watcher не найдена в package spec: ${packageSpec}`);
}

function lane(currentVersion: string, latestVersion: string): ReleaseLaneVersion {
  const current = normalizeReleaseVersion(currentVersion);
  return {
    currentVersion: current,
    latestVersion,
    outdated: compareVersions(current, latestVersion) < 0,
  };
}

function formatLane(label: string, laneVersion: ReleaseLaneVersion): string {
  return laneVersion.outdated
    ? `${label}: ${laneVersion.currentVersion} -> ${laneVersion.latestVersion}`
    : `${label}: ${laneVersion.currentVersion} актуален`;
}

function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const size = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < size; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
}

export function releaseCheckTimeoutMs(env: Readonly<Record<string, string | undefined>> = process.env): number {
  return normalizeTimeoutMs(Number.parseInt(env[RELEASE_CHECK_TIMEOUT_ENV] ?? '', 10));
}

function normalizeTimeoutMs(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : DEFAULT_RELEASE_CHECK_TIMEOUT_MS;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function versionParts(value: string): readonly number[] {
  return normalizeReleaseVersion(value)
    .split(/[.-]/)
    .map(part => Number.parseInt(part, 10))
    .map(part => Number.isFinite(part) ? part : 0);
}

function field(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object' || !(key in payload)) return null;
  const value = (payload as Readonly<Record<string, unknown>>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
