import { basename, dirname, join } from 'node:path';

export interface DesktopAppAssetPaths {
  readonly rootPath: string;
  readonly indexHtmlPath: string;
  readonly preloadPath: string;
  readonly trayIconPath: string;
}

export function resolveDesktopAppRootPath(appPath: string): string {
  return basename(appPath) === 'dist' ? dirname(appPath) : appPath;
}

export function resolveDesktopAppAssetPaths(appPath: string): DesktopAppAssetPaths {
  const rootPath = resolveDesktopAppRootPath(appPath);
  return {
    rootPath,
    indexHtmlPath: join(rootPath, 'src', 'index.html'),
    preloadPath: join(rootPath, 'dist', 'preload.cjs'),
    trayIconPath: join(rootPath, 'src', 'tray.ico'),
  };
}
