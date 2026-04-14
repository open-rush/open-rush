/**
 * SKILL.md 内容安全扫描
 *
 * 检测提示词注入、系统指令覆盖、隐藏内容和数据泄露模式。
 * 纯函数实现，无外部依赖。
 */

export interface SecurityIssue {
  type: 'prompt-injection' | 'system-override' | 'hidden-content' | 'data-exfiltration';
  description: string;
  line?: number;
}

export interface SecurityScanResult {
  safe: boolean;
  issues: SecurityIssue[];
}

// ---------------------------------------------------------------------------
// Detection patterns
// ---------------------------------------------------------------------------

interface PatternRule {
  type: SecurityIssue['type'];
  pattern: RegExp;
  description: string;
}

const LINE_PATTERNS: PatternRule[] = [
  // System override attempts
  {
    type: 'system-override',
    pattern: /ignore\s+(all\s+)?previous\s+instructions/i,
    description: 'Attempts to override previous instructions',
  },
  {
    type: 'system-override',
    pattern: /you\s+are\s+now\s+(?:a|an|the)\b/i,
    description: 'Attempts to redefine agent identity',
  },
  {
    type: 'system-override',
    pattern: /^###?\s*system\s*:/im,
    description: 'Attempts to inject system-level instructions',
  },
  {
    type: 'system-override',
    pattern: /IMPORTANT:\s*Override/i,
    description: 'Attempts to override important constraints',
  },

  // Prompt injection
  {
    type: 'prompt-injection',
    pattern: /forget\s+everything/i,
    description: 'Attempts to clear agent context',
  },
  {
    type: 'prompt-injection',
    pattern: /disregard\s+(?:all\s+)?(?:previous|prior|above)/i,
    description: 'Attempts to disregard prior context',
  },
  {
    type: 'prompt-injection',
    pattern: /new\s+instructions?\s*:/i,
    description: 'Attempts to inject new instructions',
  },
  {
    type: 'prompt-injection',
    pattern: /\bjailbreak\b/i,
    description: 'Contains jailbreak-related content',
  },

  // Data exfiltration
  {
    type: 'data-exfiltration',
    pattern: /\bcurl\b.*\b(?:POST|PUT)\b/i,
    description: 'Contains HTTP POST/PUT via curl',
  },
  {
    type: 'data-exfiltration',
    pattern: /\bfetch\b.*method\s*:\s*['"]POST['"]/i,
    description: 'Contains fetch POST request pattern',
  },
  {
    type: 'data-exfiltration',
    pattern: /\bexfiltrate\b/i,
    description: 'Contains exfiltration-related content',
  },
];

// Zero-width and invisible characters (alternation to avoid misleading character class)
const HIDDEN_CHAR_PATTERN = /\u200B|\u200C|\u200D|\uFEFF|\u202E|\u2066|\u2067|\u2068|\u2069/;

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/**
 * Scan SKILL.md content for security threats.
 * Returns { safe: true, issues: [] } if no threats found.
 */
export function scanSkillContent(content: string): SecurityScanResult {
  const issues: SecurityIssue[] = [];
  const lines = content.split('\n');

  // Check each line against patterns
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip lines inside code blocks (``` fenced)
    // Simple heuristic: track code block state
    // (handled below with a separate pass)

    for (const rule of LINE_PATTERNS) {
      if (rule.pattern.test(line)) {
        issues.push({
          type: rule.type,
          description: rule.description,
          line: lineNum,
        });
      }
    }

    // Hidden characters check
    if (HIDDEN_CHAR_PATTERN.test(line)) {
      issues.push({
        type: 'hidden-content',
        description: 'Contains invisible Unicode characters (zero-width or directional override)',
        line: lineNum,
      });
    }
  }

  // Remove false positives from code blocks
  const filteredIssues = filterCodeBlockIssues(content, issues);

  return {
    safe: filteredIssues.length === 0,
    issues: filteredIssues,
  };
}

/**
 * Remove issues that occur inside fenced code blocks (``` ... ```)
 * to avoid false positives from code examples.
 */
function filterCodeBlockIssues(content: string, issues: SecurityIssue[]): SecurityIssue[] {
  const lines = content.split('\n');
  const inCodeBlock = new Set<number>();
  let insideBlock = false;

  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i].trim())) {
      insideBlock = !insideBlock;
      continue;
    }
    if (insideBlock) {
      inCodeBlock.add(i + 1); // 1-based line numbers
    }
  }

  return issues.filter((issue) => {
    if (issue.line && inCodeBlock.has(issue.line)) return false;
    return true;
  });
}
