//
// Manages the ~/.claude/ide/<port>.lock file that lets Claude Code CLI discover
// Kale's MCP WebSocket server. The lock file is created on startup and removed
// on shutdown so stale entries never accumulate.
//

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import type { IdeLockFileContents } from './types';

const IDE_LOCK_DIR = path.join(os.homedir(), '.claude', 'ide');

/** Derives the lock file path from the server port. */
const getLockFilePath = (port: number) =>
  path.join(IDE_LOCK_DIR, `${port}.lock`);

/** Writes the lock file so Claude Code CLI can discover this server. */
export const writeIdeLockFile = async (
  port: number,
  contents: IdeLockFileContents,
) => {
  await fs.mkdir(IDE_LOCK_DIR, { recursive: true });
  const lockFilePath = getLockFilePath(port);
  await fs.writeFile(lockFilePath, JSON.stringify(contents, null, 2), 'utf8');
  return lockFilePath;
};

/** Removes the lock file on shutdown. Best-effort — does not throw. */
export const removeIdeLockFile = async (port: number) => {
  try {
    await fs.unlink(getLockFilePath(port));
  } catch {
    // File may already be gone or directory cleaned up externally.
  }
};
