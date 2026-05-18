import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
/** Returns the platform-native temporary directory for test file creation. */
export function testTmpDir(): string {
  return tmpdir();
}

/** Returns the platform-native home directory for tests. */
export function testHomeDir(): string {
  return homedir();
}

/**
 * Converts a Unix-style path used in test fixtures into a platform-native path.
 *
 * Examples:
 * - "/tmp/a" -> "%TMP%\\a" on Windows
 * - "/home/user/project" -> "%USERPROFILE%\\project" on Windows
 */
export function testPath(unixPath: string): string {
  const normalized = unixPath.replace(/\\/g, '/');
  if (process.platform !== 'win32') {
    return normalized;
  }

  if (normalized === '/tmp' || normalized.startsWith('/tmp/')) {
    const rest = normalized.slice('/tmp'.length).replace(/^\//, '');
    return rest ? path.join(testTmpDir(), ...rest.split('/')) : testTmpDir();
  }

  if (normalized === '/home/user' || normalized.startsWith('/home/user/')) {
    const rest = normalized.slice('/home/user'.length).replace(/^\//, '');
    return rest ? path.join(testHomeDir(), ...rest.split('/')) : testHomeDir();
  }

  const root = path.parse(testTmpDir()).root;
  return path.join(root, ...normalized.replace(/^\//, '').split('/'));
}

