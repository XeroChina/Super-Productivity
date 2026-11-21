import type { App } from 'electron';
import * as fs from 'fs';
import { dirname, join, resolve } from 'path';

/**
 * Resolves the portable userData directory (`Data` folder) when a `portable`
 * marker file exists either in the parent directory of the executable
 * (e.g. `<Root>/portable` when running from `<Root>/Program/Super Productivity.exe`)
 * or alongside the executable (`<ExeDir>/portable`).
 */
export const resolvePortableUserDataDir = ({
  argv,
  execPath,
  existsSync = fs.existsSync,
}: {
  argv: readonly string[];
  execPath: string;
  existsSync?: (p: string) => boolean;
}): string | undefined => {
  if (argv.some((val) => val.includes('--user-data-dir='))) {
    return undefined;
  }
  if (!execPath) {
    return undefined;
  }
  const exeDir = dirname(resolve(execPath));
  const parentDir = dirname(exeDir);

  // Case 1: App lives inside `<Root>/Program/Super Productivity.exe` and `<Root>/portable` exists
  if (parentDir !== exeDir && existsSync(join(parentDir, 'portable'))) {
    return join(parentDir, 'Data');
  }
  // Case 2: `portable` marker sits directly next to the executable
  if (existsSync(join(exeDir, 'portable'))) {
    return join(exeDir, 'Data');
  }
  return undefined;
};

/**
 * The snap userData dir: $SNAP_USER_COMMON, which survives refreshes, instead
 * of the per-revision $SNAP_USER_DATA default. Undefined outside snap and when
 * `--user-data-dir` is passed (start-app.ts applies that one).
 */
export const resolveSnapUserDataDir = ({
  argv,
  env,
  platform,
  appName,
}: {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  appName: string;
}): string | undefined => {
  if (argv.some((val) => val.includes('--user-data-dir='))) {
    return undefined;
  }
  if (platform === 'linux' && env.SNAP && env.SNAP_USER_COMMON) {
    return join(env.SNAP_USER_COMMON, '.config', appName);
  }
  return undefined;
};

/**
 * Must run before `app.requestSingleInstanceLock()`: Electron creates the
 * singleton lock in the userData dir current at that call. Locking first put
 * it in the per-revision snap dir while IndexedDB lives in the common dir, so
 * instances of two snap revisions did not exclude each other and both opened
 * the same LevelDB (#11049).
 * Also checks for portable mode (`portable` flag file) and redirects userData
 * and logs to the `Data` subfolder.
 */
export const applySnapUserDataDir = (app: App): void => {
  const portableDir = resolvePortableUserDataDir({
    argv: process.argv,
    execPath: process.execPath,
  });
  if (portableDir) {
    try {
      fs.mkdirSync(portableDir, { recursive: true });
    } catch {
      // Directory creation is best-effort before Electron initializes paths
    }
    app.setPath('userData', portableDir);
    app.setAppLogsPath(join(portableDir, 'logs'));
    return;
  }

  const dir = resolveSnapUserDataDir({
    argv: process.argv,
    env: process.env,
    platform: process.platform,
    appName: app.getName(),
  });
  if (dir) {
    app.setPath('userData', dir);
    app.setAppLogsPath();
  }
};
