/**
 * path-utils.ts — path helpers shared across session/tmux logic.
 */

/**
 * Compute the Claude project hash folder from a workDir path.
 *
 * Examples:
 * - /home/user/project -> -home-user-project
 * - D:\\Users\\me\\project -> -d-Users-me-project
 */
export function computeProjectHash(workDir: string): string {
  const normalized = workDir.replace(/\\/g, '/').trim();
  const withLowerDrive = normalized.replace(/^[A-Za-z]:/, (m) => `${m[0].toLowerCase()}`);
  const segments = withLowerDrive
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/:/g, '').replace(/\s+/g, '-'));

  if (segments.length === 0) return '-';
  return `-${segments.join('-')}`;
}
