/**
 * SKILL.md URL 解析与抓取工具函数
 *
 * 从 GitHub/GitLab 页面 URL 转换为 raw content URL，
 * 从 YAML frontmatter 提取 description。
 */

// ---------------------------------------------------------------------------
// URL Parsing
// ---------------------------------------------------------------------------

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

export interface ParsedGitLabUrl {
  host: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

export function parseGitHubUrl(sourceUrl: string): ParsedGitHubUrl | null {
  const match = sourceUrl.match(
    /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+))?)?$/
  );
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    branch: match[3] || 'main',
    path: match[4] || '',
  };
}

export function parseGitLabUrl(sourceUrl: string): ParsedGitLabUrl | null {
  const match = sourceUrl.match(
    /^(https?:\/\/[^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/-\/tree\/([^/]+))?(?:\/(.+))?$/
  );
  if (!match) return null;
  return {
    host: match[1],
    owner: match[2],
    repo: match[3],
    branch: match[4] || 'main',
    path: match[5] || '',
  };
}

// ---------------------------------------------------------------------------
// Raw URL Conversion
// ---------------------------------------------------------------------------

/**
 * Convert a GitHub/GitLab page URL to the raw SKILL.md content URL.
 */
export function sourceUrlToSkillMdRawUrl(sourceUrl: string, sourceType?: string): string | null {
  // GitHub
  if (sourceType === 'github' || sourceUrl.includes('github.com')) {
    const parsed = parseGitHubUrl(sourceUrl);
    if (!parsed) return null;
    const filePath = parsed.path ? `${parsed.path}/SKILL.md` : 'SKILL.md';
    return `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${parsed.branch}/${filePath}`;
  }

  // GitLab
  if (sourceType === 'gitlab' || sourceUrl.includes('gitlab')) {
    const parsed = parseGitLabUrl(sourceUrl);
    if (!parsed) return null;
    const filePath = parsed.path ? `${parsed.path}/SKILL.md` : 'SKILL.md';
    return `${parsed.host}/${parsed.owner}/${parsed.repo}/-/raw/${parsed.branch}/${filePath}`;
  }

  // Direct URL
  if (sourceUrl.endsWith('.md') || sourceUrl.endsWith('/SKILL.md')) {
    return sourceUrl;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Frontmatter Extraction
// ---------------------------------------------------------------------------

/**
 * Extract description from SKILL.md YAML frontmatter.
 */
export function extractDescriptionFromFrontmatter(content: string): string | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const descMatch = match[1].match(/^description:\s*(.+)$/m);
  return descMatch?.[1]?.trim() ?? null;
}

/**
 * Extract all frontmatter fields as key-value pairs.
 */
export function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) result[kv[1]] = kv[2].trim();
  }
  return result;
}

/**
 * Strip YAML frontmatter from markdown content.
 */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n*/, '');
}
