'use client';

import {
  AlertCircleIcon,
  CheckIcon,
  GlobeIcon,
  InfoIcon,
  Loader2Icon,
  LockIcon,
  UploadCloudIcon,
  XIcon,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillFormData {
  skillName: string;
  description: string;
  category: string;
  tags: string[];
  license: string;
  visibility: string;
  version: string;
}

interface ParsedGitUrl {
  platform: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

interface UploadedFile {
  name: string;
  relativePath: string;
  content: string;
}

// ---------------------------------------------------------------------------
// URL parser
// ---------------------------------------------------------------------------

function parseGitUrl(url: string): ParsedGitUrl | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;

    const platform = u.hostname.includes('github')
      ? 'GitHub'
      : u.hostname.includes('gitlab')
        ? 'GitLab'
        : 'Git';
    const owner = parts[0];
    const repo = parts[1];
    const branch =
      parts.length > 3 && (parts[2] === 'tree' || parts[2] === 'blob') ? parts[3] : 'main';
    const path = parts.length > 4 ? `/${parts.slice(4).join('/')}` : '/';

    return { platform, owner, repo, branch, path };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const PUBLISH_CATEGORIES = [
  { value: 'general', label: '通用' },
  { value: 'ui-components', label: 'UI 组件' },
  { value: 'documentation', label: '文档' },
  { value: 'code-quality', label: '代码质量' },
  { value: 'database', label: '数据库' },
  { value: 'security', label: '安全' },
  { value: 'testing', label: '测试' },
  { value: 'ai-sdk', label: 'AI & SDK' },
  { value: 'devops', label: 'DevOps' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PublishSkillModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  existingSkill?: {
    name: string;
    description: string;
    category?: string;
    tags?: string[];
    visibility?: string;
    latestVersion?: string;
  } | null;
}

export function PublishSkillModal({
  open,
  onClose,
  onSuccess,
  existingSkill,
}: PublishSkillModalProps) {
  const isUpdate = !!existingSkill;
  const [activeTab, setActiveTab] = useState<'remote' | 'local'>(isUpdate ? 'remote' : 'remote');

  // Remote URL state
  const [repoUrl, setRepoUrl] = useState('');
  const [parsedUrl, setParsedUrl] = useState<ParsedGitUrl | null>(null);
  const [parseError, setParseError] = useState('');

  // Local folder state
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [folderName, setFolderName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Shared form fields
  const [form, setForm] = useState<SkillFormData>({
    skillName: existingSkill?.name?.replace(/^@[^/]+\//, '') ?? '',
    description: existingSkill?.description ?? '',
    category: existingSkill?.category ?? 'general',
    tags: existingSkill?.tags ?? [],
    license: '',
    visibility: existingSkill?.visibility ?? 'public',
    version: '1.0.0',
  });
  const [tagInput, setTagInput] = useState('');
  const [skillMdContent, setSkillMdContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const hasSkillMd = useMemo(
    () => uploadedFiles.some((f) => f.name === 'SKILL.md'),
    [uploadedFiles]
  );

  const updateField = useCallback((key: keyof SkillFormData, value: string | string[]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleParseUrl = useCallback(() => {
    if (!repoUrl.trim()) return;
    const result = parseGitUrl(repoUrl.trim());
    if (result) {
      setParsedUrl(result);
      setParseError('');
      // Auto-fill skill name from repo
      if (!form.skillName) {
        const pathParts = result.path.split('/').filter(Boolean);
        const lastPart = pathParts[pathParts.length - 1] ?? result.repo;
        updateField('skillName', lastPart);
      }
    } else {
      setParsedUrl(null);
      setParseError('无法解析 URL，请检查格式');
    }
  }, [repoUrl, form.skillName, updateField]);

  // Keep raw File objects for upload
  const [rawFiles, setRawFiles] = useState<File[]>([]);

  // Local folder handling — read file list + extract SKILL.md content
  const processFiles = useCallback((files: FileList) => {
    const uploaded: UploadedFile[] = [];
    const raw: File[] = [];
    let folder = '';

    Array.from(files).forEach((file) => {
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      if (!folder) folder = path.split('/')[0] ?? file.name;
      uploaded.push({ name: file.name, relativePath: path, content: '' });
      raw.push(file);

      // Read SKILL.md content
      if (file.name === 'SKILL.md') {
        const reader = new FileReader();
        reader.onload = () => {
          setSkillMdContent(reader.result as string);
        };
        reader.readAsText(file);
      }
    });

    setUploadedFiles(uploaded);
    setRawFiles(raw);
    setFolderName(folder);
  }, []);

  const handleFolderSelect = useCallback(() => folderInputRef.current?.click(), []);

  const handleSubmit = useCallback(async () => {
    if (!form.skillName.trim()) {
      setError('Skill 名称不能为空');
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const fullName = `@openrush/${form.skillName.trim()}`;
      const skillName = isUpdate ? existingSkill?.name : fullName;

      // Local folder mode: upload files via FormData to /api/skills/upload
      if (activeTab === 'local' && rawFiles.length > 0) {
        const formData = new FormData();
        formData.set('name', skillName);
        formData.set('description', form.description.trim());
        formData.set('category', form.category);
        formData.set('tags', form.tags.join(','));
        formData.set('visibility', form.visibility);
        formData.set('license', form.license.trim());
        formData.set('version', form.version);
        if (skillMdContent) formData.set('skillMdContent', skillMdContent);
        for (const file of rawFiles) {
          formData.append('files', file);
        }
        const res = await fetch('/api/skills/upload', { method: 'POST', body: formData });
        const json = await res.json();
        if (!json.success) throw new Error(json.error ?? 'Upload failed');
      } else {
        // Remote URL or metadata-only mode: JSON API
        const body = {
          name: skillName,
          description: form.description.trim(),
          category: form.category,
          tags: form.tags,
          visibility: form.visibility,
          license: form.license.trim() || undefined,
          sourceUrl: repoUrl.trim() || undefined,
          sourceType: repoUrl.trim() ? 'github' : 'registry',
          skillMdContent: skillMdContent || undefined,
        };
        const url = isUpdate ? `/api/skills/${encodeURIComponent(skillName)}` : '/api/skills';
        const res = await fetch(url, {
          method: isUpdate ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error ?? 'Failed');
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }, [form, repoUrl, rawFiles, activeTab, skillMdContent, isUpdate, existingSkill]);

  if (!open) return null;

  // Success state
  if (success) {
    const installCmd = `npx reskill@latest install @openrush/${form.skillName}`;
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={onClose}
      >
        <div
          className="w-full max-w-md rounded-xl bg-background p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col items-center py-4 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <CheckIcon className="h-6 w-6 text-green-600" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">Skill 发布成功！</h3>
            <p className="mb-4 text-sm text-muted-foreground">你的 Skill 已在市场上架。</p>
            <div className="flex w-full items-center rounded-lg bg-muted px-4 py-3">
              <code className="flex-1 text-left font-mono text-sm truncate">{installCmd}</code>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setSuccess(false);
              onSuccess();
              onClose();
            }}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            完成
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[85vh] w-full max-w-[600px] flex-col overflow-hidden rounded-xl bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">{isUpdate ? '更新 Skill' : '发布 Skill'}</h2>
              <p className="text-sm text-muted-foreground">
                {isUpdate ? `更新 ${existingSkill?.name}` : '将你的 Skill 发布到市场'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircleIcon className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Tabs */}
          {!isUpdate && (
            <div className="flex rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setActiveTab('remote')}
                className={`flex-1 rounded-l-lg px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'remote' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
              >
                远程 URL
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('local')}
                className={`flex-1 rounded-r-lg px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'local' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
              >
                本地文件夹
              </button>
            </div>
          )}

          {/* Remote URL tab */}
          {activeTab === 'remote' && (
            <>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2 mb-1">
                  <InfoIcon className="h-3.5 w-3.5" />
                  <span className="font-medium text-foreground">支持的 URL 格式</span>
                </div>
                <div className="pl-5 space-y-0.5">
                  <div className="font-mono text-[10px]">
                    https://github.com/owner/repo/tree/main/skills/my-skill
                  </div>
                  <div className="font-mono text-[10px]">
                    https://gitlab.com/group/repo/-/tree/main/skills
                  </div>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">仓库 URL</label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    onBlur={handleParseUrl}
                    placeholder="https://github.com/owner/repo"
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleParseUrl}
                    disabled={!repoUrl.trim()}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border hover:bg-accent disabled:opacity-50"
                  >
                    {parsedUrl ? (
                      <CheckIcon className="h-4 w-4 text-green-500" />
                    ) : (
                      <GlobeIcon className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {parseError && (
                <div className="flex items-center gap-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-900/50 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-200">
                  <AlertCircleIcon className="h-4 w-4 shrink-0" />
                  <span>{parseError}</span>
                </div>
              )}

              {parsedUrl && (
                <div className="rounded-md border border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-900/20 px-3 py-2.5">
                  <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-300">
                    <CheckIcon className="h-4 w-4" /> 已识别仓库
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div>
                      <span className="text-muted-foreground">平台：</span>{' '}
                      <span className="font-mono font-medium">{parsedUrl.platform}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">所有者：</span>{' '}
                      <span className="font-mono font-medium">{parsedUrl.owner}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">仓库：</span>{' '}
                      <span className="font-mono font-medium">{parsedUrl.repo}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">分支：</span>{' '}
                      <span className="font-mono font-medium">{parsedUrl.branch}</span>
                    </div>
                    {parsedUrl.path !== '/' && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">路径：</span>{' '}
                        <span className="font-mono font-medium">{parsedUrl.path}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Local folder tab */}
          {activeTab === 'local' && (
            <>
              <input
                ref={folderInputRef}
                type="file"
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                multiple
                className="hidden"
                onChange={(e) => e.target.files && processFiles(e.target.files)}
              />
              <div
                className={`flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center cursor-pointer transition-colors ${isDragging ? 'border-primary bg-primary/5' : uploadedFiles.length > 0 ? 'border-green-500 bg-green-50 dark:bg-green-900/10' : 'hover:bg-muted/50'}`}
                onClick={handleFolderSelect}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files);
                }}
              >
                {uploadedFiles.length === 0 ? (
                  <>
                    <div className="rounded-full bg-muted p-3 mb-3">
                      <UploadCloudIcon className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div className="text-sm font-medium">选择 Skill 文件夹</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      必须包含 <code className="font-mono bg-muted px-1 rounded">SKILL.md</code>{' '}
                      文件
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-3 mb-3">
                      <CheckIcon className="h-6 w-6 text-green-600" />
                    </div>
                    <div className="text-sm font-medium">{folderName}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {uploadedFiles.length} 个文件 ·{' '}
                      {hasSkillMd ? (
                        <span className="text-green-600">已找到 SKILL.md</span>
                      ) : (
                        <span className="text-red-600">缺少 SKILL.md</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setUploadedFiles([]);
                        setFolderName('');
                      }}
                      className="mt-2 text-xs font-medium text-destructive hover:text-destructive/80"
                    >
                      清除选择
                    </button>
                  </>
                )}
              </div>

              {activeTab === 'local' && (
                <div>
                  <label className="text-sm font-medium">版本号</label>
                  <input
                    type="text"
                    value={form.version}
                    onChange={(e) => updateField('version', e.target.value)}
                    placeholder="1.0.0"
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">格式：x.y.z（如 1.0.0）</p>
                </div>
              )}
            </>
          )}

          {/* Shared form fields */}
          <div className="space-y-4 border-t pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Skill 名称</label>
                <div className="mt-1 flex">
                  <span className="flex items-center rounded-l-lg border border-r-0 border-border bg-muted px-3 text-xs text-muted-foreground">
                    @openrush/
                  </span>
                  <input
                    type="text"
                    value={form.skillName}
                    onChange={(e) => updateField('skillName', e.target.value)}
                    disabled={isUpdate}
                    placeholder="my-skill"
                    className="flex-1 rounded-r-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">分类</label>
                <select
                  value={form.category}
                  onChange={(e) => updateField('category', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  {PUBLISH_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">描述</label>
              <textarea
                value={form.description}
                onChange={(e) => updateField('description', e.target.value)}
                rows={2}
                placeholder="简要描述这个 Skill 的功能..."
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">标签</label>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 min-h-[38px]">
                  {form.tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs"
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() =>
                          updateField(
                            'tags',
                            form.tags.filter((x) => x !== t)
                          )
                        }
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const t = tagInput.trim();
                        if (t && !form.tags.includes(t)) {
                          updateField('tags', [...form.tags, t]);
                          setTagInput('');
                        }
                      }
                    }}
                    placeholder="输入后按 Enter"
                    className="flex-1 min-w-[60px] border-0 bg-transparent px-1 py-0 text-xs outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">许可证</label>
                <input
                  type="text"
                  value={form.license}
                  onChange={(e) => updateField('license', e.target.value)}
                  placeholder="MIT"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">SKILL.md 内容</label>
              <p className="text-[11px] text-muted-foreground mb-1">
                Agent 使用此 Skill 时的指令内容，支持 Markdown
              </p>
              <textarea
                value={skillMdContent}
                onChange={(e) => setSkillMdContent(e.target.value)}
                rows={8}
                placeholder={
                  '# My Skill\n\nInstructions for the AI agent...\n\n## When to use\n\nUse this skill when...'
                }
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono resize-y"
              />
            </div>

            <div>
              <label className="text-sm font-medium">可见性</label>
              <div className="mt-1 flex gap-3">
                <button
                  type="button"
                  onClick={() => updateField('visibility', 'public')}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${form.visibility === 'public' ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:bg-accent'}`}
                >
                  <GlobeIcon className="h-3.5 w-3.5" /> 公开
                </button>
                <button
                  type="button"
                  onClick={() => updateField('visibility', 'private')}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${form.visibility === 'private' ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:bg-accent'}`}
                >
                  <LockIcon className="h-3.5 w-3.5" /> 仅自己可见
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-end gap-3 border-t px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {submitting && <Loader2Icon className="h-4 w-4 animate-spin" />}
            {isUpdate ? '更新 Skill' : '发布 Skill'}
          </button>
        </div>
      </div>
    </div>
  );
}
