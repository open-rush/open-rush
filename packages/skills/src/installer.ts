/**
 * Skill 动态安装器
 *
 * 通过接口抽象外部依赖（DB、OSS），提供制品下载、SHA256 完整性校验和原子安装。
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SKILL_MD_RELATIVE = '.claude/skills';
const INSTALL_TIMEOUT_MS = 30_000;
const MAX_TARBALL_SIZE = 50 * 1024 * 1024; // 50MB

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Resolves a skill name to a downloadable artifact URL + integrity hash */
export interface SkillArtifactResolver {
  resolve(skillName: string): Promise<{ url: string; integrity: string }>;
}

/** Downloads artifact data from a URL */
export interface ArtifactDownloader {
  download(url: string, timeoutMs?: number): Promise<Buffer>;
}

// ---------------------------------------------------------------------------
// Default implementations
// ---------------------------------------------------------------------------

/** Default downloader using global fetch */
export class HttpArtifactDownloader implements ArtifactDownloader {
  async download(url: string, timeoutMs = INSTALL_TIMEOUT_MS): Promise<Buffer> {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 100) {
      throw new Error(`Tarball too small: ${buffer.length} bytes`);
    }
    if (buffer.length > MAX_TARBALL_SIZE) {
      throw new Error(`Tarball is too large: ${buffer.length} bytes (max ${MAX_TARBALL_SIZE})`);
    }
    return buffer;
  }
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * 从 skill 引用（如 @scope/skill-name）提取目录名（最后一段）
 */
export function extractSkillDirName(skillRef: string): string {
  const trimmed = skillRef.trim();
  if (!trimmed) return trimmed;
  const lastSlash = trimmed.lastIndexOf('/');
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
}

/**
 * 校验 tarball 的 SHA256 完整性（SRI 格式：sha256-<base64>）
 */
export function verifyIntegrity(data: Buffer, expected: string): void {
  if (!expected) return; // 旧 skill 可能没有 integrity
  const match = expected.match(/^sha256-(.+)$/);
  if (!match) return; // 非标准格式跳过
  const actual = createHash('sha256').update(data).digest('base64');
  if (actual !== match[1]) {
    throw new Error(`Integrity check failed: expected ${expected}, got sha256-${actual}`);
  }
}

// ---------------------------------------------------------------------------
// SkillInstaller
// ---------------------------------------------------------------------------

export class SkillInstaller {
  private resolver: SkillArtifactResolver;
  private downloader: ArtifactDownloader;

  constructor(resolver: SkillArtifactResolver, downloader?: ArtifactDownloader) {
    this.resolver = resolver;
    this.downloader = downloader ?? new HttpArtifactDownloader();
  }

  /** Check if a skill is already installed (SKILL.md exists) */
  isSkillInstalled(projectPath: string, skillRef: string): boolean {
    const dirName = extractSkillDirName(skillRef);
    const skillMdPath = join(projectPath, SKILL_MD_RELATIVE, dirName, 'SKILL.md');
    return existsSync(skillMdPath);
  }

  /**
   * Download and install a single skill (atomic operation).
   * Extracts to a temp directory, then renames to final path.
   */
  async installSkill(projectPath: string, skillRef: string): Promise<void> {
    const { url, integrity } = await this.resolver.resolve(skillRef);
    const tarball = await this.downloader.download(url);

    verifyIntegrity(tarball, integrity);

    const dirName = extractSkillDirName(skillRef);
    const skillDir = join(projectPath, SKILL_MD_RELATIVE, dirName);
    const tmpDir = `${skillDir}.installing`;

    // Clean up any leftover temp directory
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });

    const tmpTarball = join(tmpDir, '.skill.tgz');
    writeFileSync(tmpTarball, tarball);

    try {
      await execFileAsync('tar', ['xzf', tmpTarball, '--strip-components=1', '-C', tmpDir], {
        timeout: INSTALL_TIMEOUT_MS,
      });
      unlinkSync(tmpTarball);

      // Concurrent safety: if another process installed it, skip rename
      if (this.isSkillInstalled(projectPath, skillRef)) {
        rmSync(tmpDir, { recursive: true, force: true });
        return;
      }

      rmSync(skillDir, { recursive: true, force: true });
      renameSync(tmpDir, skillDir);
    } catch (err) {
      rmSync(tmpDir, { recursive: true, force: true });
      throw err;
    }
  }

  /**
   * Ensure all configured skills are installed.
   * Deduplicates, filters already-installed, installs missing in parallel.
   */
  async ensureSkillsInstalled(projectPath: string, skills: string[]): Promise<void> {
    if (!skills.length) return;
    const unique = [...new Set(skills)];
    const missing = unique.filter((s) => !this.isSkillInstalled(projectPath, s));
    if (!missing.length) return;
    await Promise.all(missing.map((s) => this.installSkill(projectPath, s)));
  }
}
