import { describe, expect, it } from 'vitest';
import {
  extractDescriptionFromFrontmatter,
  parseFrontmatter,
  parseGitHubUrl,
  parseGitLabUrl,
  sourceUrlToSkillMdRawUrl,
  stripFrontmatter,
} from './skill-md-utils';

// ---------------------------------------------------------------------------
// parseGitHubUrl
// ---------------------------------------------------------------------------

describe('parseGitHubUrl', () => {
  it('解析标准 GitHub URL', () => {
    expect(parseGitHubUrl('https://github.com/owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      path: '',
    });
  });

  it('解析带 branch 的 URL', () => {
    expect(parseGitHubUrl('https://github.com/owner/repo/tree/develop')).toEqual({
      owner: 'owner',
      repo: 'repo',
      branch: 'develop',
      path: '',
    });
  });

  it('解析带子目录路径的 URL', () => {
    expect(
      parseGitHubUrl('https://github.com/kanyun-inc/octo-cli/tree/main/skills/octopus-rum')
    ).toEqual({
      owner: 'kanyun-inc',
      repo: 'octo-cli',
      branch: 'main',
      path: 'skills/octopus-rum',
    });
  });

  it('解析 .git 后缀的 URL', () => {
    expect(parseGitHubUrl('https://github.com/owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      path: '',
    });
  });

  it('非 GitHub URL 返回 null', () => {
    expect(parseGitHubUrl('https://gitlab.com/owner/repo')).toBeNull();
    expect(parseGitHubUrl('not-a-url')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseGitLabUrl
// ---------------------------------------------------------------------------

describe('parseGitLabUrl', () => {
  it('解析标准 GitLab URL', () => {
    expect(parseGitLabUrl('https://gitlab.com/owner/repo')).toEqual({
      host: 'https://gitlab.com',
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      path: '',
    });
  });

  it('解析自托管 GitLab URL', () => {
    expect(parseGitLabUrl('https://gitlab-ee.example.com/team/my-skill/-/tree/develop')).toEqual({
      host: 'https://gitlab-ee.example.com',
      owner: 'team',
      repo: 'my-skill',
      branch: 'develop',
      path: '',
    });
  });

  it('解析带路径的 GitLab URL', () => {
    expect(parseGitLabUrl('https://gitlab.com/owner/repo/-/tree/main/path/to/skill')).toEqual({
      host: 'https://gitlab.com',
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      path: 'path/to/skill',
    });
  });

  it('无效 URL 返回 null', () => {
    expect(parseGitLabUrl('not-a-url')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sourceUrlToSkillMdRawUrl
// ---------------------------------------------------------------------------

describe('sourceUrlToSkillMdRawUrl', () => {
  it('GitHub 根 URL 转换为 raw SKILL.md URL', () => {
    expect(sourceUrlToSkillMdRawUrl('https://github.com/owner/repo')).toBe(
      'https://raw.githubusercontent.com/owner/repo/main/SKILL.md'
    );
  });

  it('GitHub 带 tree path 的 URL 转换', () => {
    expect(
      sourceUrlToSkillMdRawUrl(
        'https://github.com/kanyun-inc/octo-cli/tree/main/skills/octopus-rum'
      )
    ).toBe(
      'https://raw.githubusercontent.com/kanyun-inc/octo-cli/main/skills/octopus-rum/SKILL.md'
    );
  });

  it('GitHub 带自定义分支', () => {
    expect(sourceUrlToSkillMdRawUrl('https://github.com/owner/repo/tree/develop/sub/dir')).toBe(
      'https://raw.githubusercontent.com/owner/repo/develop/sub/dir/SKILL.md'
    );
  });

  it('非 GitHub URL 返回 null', () => {
    expect(sourceUrlToSkillMdRawUrl('https://example.com/something')).toBeNull();
  });

  it('直接 .md URL 原样返回', () => {
    expect(sourceUrlToSkillMdRawUrl('https://cdn.example.com/SKILL.md')).toBe(
      'https://cdn.example.com/SKILL.md'
    );
  });
});

// ---------------------------------------------------------------------------
// extractDescriptionFromFrontmatter
// ---------------------------------------------------------------------------

describe('extractDescriptionFromFrontmatter', () => {
  it('提取 description 字段', () => {
    const content = '---\nname: test\ndescription: A powerful skill\n---\n# Content';
    expect(extractDescriptionFromFrontmatter(content)).toBe('A powerful skill');
  });

  it('无 frontmatter 返回 null', () => {
    expect(extractDescriptionFromFrontmatter('# Just markdown')).toBeNull();
  });

  it('无 description 字段返回 null', () => {
    expect(extractDescriptionFromFrontmatter('---\nname: test\n---\n# Content')).toBeNull();
  });

  it('空 description 返回空字符串', () => {
    expect(extractDescriptionFromFrontmatter('---\ndescription: \n---\n')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

describe('parseFrontmatter', () => {
  it('解析多个字段', () => {
    const content = '---\nname: test\nversion: 1.0.0\n---\n# Content';
    expect(parseFrontmatter(content)).toEqual({ name: 'test', version: '1.0.0' });
  });

  it('无 frontmatter 返回空对象', () => {
    expect(parseFrontmatter('# Just markdown')).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// stripFrontmatter
// ---------------------------------------------------------------------------

describe('stripFrontmatter', () => {
  it('移除 frontmatter', () => {
    const content = '---\nname: test\n---\n# Content';
    expect(stripFrontmatter(content)).toBe('# Content');
  });

  it('无 frontmatter 原样返回', () => {
    expect(stripFrontmatter('# Just markdown')).toBe('# Just markdown');
  });
});
