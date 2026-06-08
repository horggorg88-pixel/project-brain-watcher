import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesktopCorePaths } from './desktop-profile-store.js';

export interface DesktopAccessSession {
  readonly email: string;
  readonly serverVerified: boolean;
  readonly signedInAt: string;
}

export function readDesktopAccessSession(paths: DesktopCorePaths): DesktopAccessSession | null {
  const path = accessSessionPath(paths);
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return toDesktopAccessSession(parsed);
  } catch {
    return null;
  }
}

export function saveDesktopAccessSession(
  paths: DesktopCorePaths,
  input: Pick<DesktopAccessSession, 'email' | 'serverVerified'>,
): DesktopAccessSession {
  const session = {
    email: input.email.trim().toLowerCase(),
    serverVerified: input.serverVerified,
    signedInAt: new Date().toISOString(),
  };
  mkdirSync(paths.userDataPath, { recursive: true });
  writeFileSync(accessSessionPath(paths), JSON.stringify(session, null, 2), 'utf-8');
  return session;
}

export function clearDesktopAccessSession(paths: DesktopCorePaths): void {
  const path = accessSessionPath(paths);
  if (existsSync(path)) unlinkSync(path);
}

function accessSessionPath(paths: DesktopCorePaths): string {
  return join(paths.userDataPath, 'desktop-access-session.json');
}

function toDesktopAccessSession(value: unknown): DesktopAccessSession | null {
  if (!isRecord(value)) return null;
  if (typeof value.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) return null;
  return {
    email: value.email.trim().toLowerCase(),
    serverVerified: value.serverVerified === true,
    signedInAt: typeof value.signedInAt === 'string' ? value.signedInAt : new Date(0).toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
