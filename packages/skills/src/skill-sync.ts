/**
 * Reskill install → 项目级 DB 同步
 *
 * 从 reskill install 命令中解析 skill refs，验证磁盘安装状态，
 * 同步到项目配置（union merge — 只加不删）。
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { extractSkillDirName } from './installer.js';

const SKILL_MD_RELATIVE = '.claude/skills';

const RESKILL_INSTALL_RE = /(?:npx\s+(?:reskill@\S+|reskill)\s+|reskill\s+)install\b/;

const FLAGS_WITH_VALUE = new Set([
  '--token',
  '-t',
  '--registry',
  '-r',
  '--mode',
  '-a',
  '--agent',
  '-s',
  '--skill',
]);

const FLAGS_NO_VALUE = new Set([
  '--force',
  '-f',
  '--global',
  '-g',
  '--no-save',
  '--skip-manifest',
  '--yes',
  '-y',
  '--all',
  '--list',
]);

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Abstract target for skill sync (replaces direct DB access) */
export interface SkillSyncTarget {
  getCurrentSkills(projectId: string): Promise<string[]>;
  setSkills(projectId: string, skills: string[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/** Check if a command is a reskill install command */
export function isReskillInstall(command: string): boolean {
  return RESKILL_INSTALL_RE.test(command);
}

/**
 * Parse skill refs (positional args) from a reskill install command.
 * Filters out known flags and their values, stops at shell operators.
 */
export function parseReskillInstallRefs(command: string): string[] {
  const match = command.match(RESKILL_INSTALL_RE);
  if (!match) return [];

  const afterInstall = command.slice((match.index ?? 0) + match[0].length);
  const tokens = afterInstall.trim().split(/\s+/);
  const refs: string[] = [];
  let skipNext = false;

  for (const token of tokens) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (!token) continue;

    if (FLAGS_WITH_VALUE.has(token)) {
      skipNext = true;
      continue;
    }
    if (FLAGS_NO_VALUE.has(token)) continue;

    // Shell operators — stop parsing
    if (/^[|&;>]/.test(token)) break;

    refs.push(token);
  }

  return refs;
}

/**
 * Filter refs to only those with an existing SKILL.md on disk.
 */
export function filterVerifiedRefs(projectPath: string, refs: string[]): string[] {
  return refs.filter((ref) => {
    const dirName = extractSkillDirName(ref);
    const skillMdPath = join(projectPath, SKILL_MD_RELATIVE, dirName, 'SKILL.md');
    return existsSync(skillMdPath);
  });
}

/**
 * Sync verified skill refs to a project via the SkillSyncTarget interface.
 * Union merge only (adds new refs, never removes existing).
 */
export async function syncSkillRefsToProject(
  target: SkillSyncTarget,
  projectId: string,
  projectPath: string,
  refs: string[]
): Promise<void> {
  const verified = filterVerifiedRefs(projectPath, refs);
  if (verified.length === 0) return;

  const currentSkills = await target.getCurrentSkills(projectId);
  const merged = [...new Set([...currentSkills, ...verified])];

  // Skip update if no new refs were added
  if (!verified.some((ref) => !currentSkills.includes(ref))) return;

  await target.setSkills(projectId, merged);
}
