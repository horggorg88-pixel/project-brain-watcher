import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const desktopRoot = 'apps/watcher-desktop';

verifyWatcherTarball();
ensureDesktopDependencies();
run('npm', ['--prefix', desktopRoot, 'run', 'build']);
run('npm', ['test']);

function ensureDesktopDependencies() {
  const electronPackage = join(desktopRoot, 'node_modules', 'electron', 'package.json');
  if (process.env.CI === 'true' || !existsSync(electronPackage)) {
    run('npm', ['--prefix', desktopRoot, 'ci']);
  }
}

function verifyWatcherTarball() {
  const tempRoot = mkdtempSync(join(tmpdir(), 'project-brain-watcher-pack-'));
  try {
    run('npm', ['pack', '.', '--pack-destination', tempRoot]);
    const watcherPackage = JSON.parse(readFileSync('package.json', 'utf8'));
    const tarball = join(tempRoot, `project-brain-watcher-${watcherPackage.version}.tgz`);
    if (!existsSync(tarball)) {
      throw new Error(`Packed watcher tarball not found: ${tarball}`);
    }
    run('npm', ['install', '--prefix', tempRoot, tarball, '--ignore-scripts']);
    const watcherBin = join(tempRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'project-brain-watcher.cmd' : 'project-brain-watcher');
    run(watcherBin, ['--help']);
    run(watcherBin, ['desktop', 'status', '--desktop-dir', join(tempRoot, 'desktop')]);
    run(watcherBin, [
      'service',
      'plan',
      '--path',
      tempRoot,
      '--server',
      'https://brain.example',
      '--token-env',
      'MCP_BEARER_TOKEN',
      '--project',
      'pack-smoke',
    ]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function run(command, args) {
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  const result = spawnSync(executable, args, {
    shell: process.platform === 'win32',
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
