'use client';

import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import {
  ArrowLeftIcon,
  CalendarIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GlobeIcon,
  Loader2,
  LockIcon,
  RefreshCwIcon,
  TrashIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Streamdown } from 'streamdown';
import { PublishSkillModal } from '@/components/skills/publish-skill-modal';
import { StarButton } from '@/components/skills/star-button';
import { Badge } from '@/components/ui/badge';
import { stripFrontmatter } from '@/lib/skills/skill-md-utils';

const mdPlugins = { cjk, code, math };

interface SkillDetail {
  id: string;
  name: string;
  description: string;
  sourceType: string;
  sourceUrl: string | null;
  category: string | null;
  tags: string[];
  visibility: string;
  latestVersion: string | null;
  skillMdContent: string | null;
  license: string | null;
  starCount: number;
  installCount: number;
  createdById: string;
  members: string[];
  groupId: string | null;
  createdAt: string;
  updatedAt: string;
  isStarred?: boolean;
}

export default function SkillDetailPage() {
  const params = useParams();
  const router = useRouter();
  const skillName = decodeURIComponent(params.id as string);

  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [mdContent, setMdContent] = useState<string | null>(null);
  const [mdLoading, setMdLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showUpdate, setShowUpdate] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [togglingVis, setTogglingVis] = useState(false);

  const loadSkill = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skillName)}`);
      const json = await res.json();
      if (json.success) {
        setSkill(json.data);
        // If skill has md content, use it directly
        if (json.data.skillMdContent) {
          setMdContent(json.data.skillMdContent);
        } else {
          // Lazy fetch SKILL.md from source URL
          setMdLoading(true);
          try {
            const mdRes = await fetch(`/api/skills/${encodeURIComponent(skillName)}/skill-md`);
            const mdJson = await mdRes.json();
            if (mdJson.success && mdJson.data?.content) {
              setMdContent(mdJson.data.content);
              // Update skill object too
              setSkill((prev) => (prev ? { ...prev, skillMdContent: mdJson.data.content } : prev));
            }
          } catch {
            /* silent */
          } finally {
            setMdLoading(false);
          }
        }
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [skillName]);

  useEffect(() => {
    void loadSkill();
  }, [loadSkill]);

  const installCmd = `npx reskill@latest install ${skillName}`;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [installCmd]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skillName)}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) router.push('/skills');
    } catch {
      /* silent */
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [skillName, router]);

  const handleToggleVisibility = useCallback(
    async (newVis: 'public' | 'private') => {
      if (!skill) return;
      setTogglingVis(true);
      try {
        await fetch(`/api/skills/${encodeURIComponent(skill.name)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visibility: newVis }),
        });
        await loadSkill();
      } catch {
        /* silent */
      } finally {
        setTogglingVis(false);
      }
    },
    [skill, loadSkill]
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!skill) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <FileTextIcon className="h-6 w-6 text-destructive" />
          </div>
          <p className="mb-1 text-sm font-medium">Skill not found</p>
          <p className="mb-4 text-xs text-muted-foreground">{skillName}</p>
          <Link
            href="/skills"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" /> Back to Skills
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-8 py-10 space-y-6">
        {/* Back nav */}
        <Link
          href="/skills"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" /> Back to Skills
        </Link>

        {/* Header */}
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{skill.name}</h1>
          {skill.latestVersion && (
            <Badge variant="secondary" className="font-normal text-xs">
              {skill.latestVersion.replace(/^v/, '')}
            </Badge>
          )}

          <div className="ml-auto flex items-center gap-2">
            {/* Visibility toggle */}
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  handleToggleVisibility(skill.visibility === 'public' ? 'private' : 'public')
                }
                disabled={togglingVis}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  skill.visibility === 'private'
                    ? 'text-amber-700 border-amber-200 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400'
                    : 'text-muted-foreground border-border hover:bg-accent'
                }`}
              >
                {togglingVis ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : skill.visibility === 'private' ? (
                  <LockIcon className="h-3.5 w-3.5" />
                ) : (
                  <GlobeIcon className="h-3.5 w-3.5" />
                )}
                {skill.visibility === 'private' ? 'Private' : 'Public'}
              </button>
            </div>

            {/* Update button */}
            <button
              type="button"
              onClick={() => setShowUpdate(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
            >
              <RefreshCwIcon className="h-3.5 w-3.5" /> 更新
            </button>

            {/* Star */}
            <StarButton
              skillName={skill.name}
              initialCount={skill.starCount}
              initialStarred={skill.isStarred}
              size="md"
            />

            {/* More actions dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMenu(!showMenu)}
                className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-accent transition-colors"
              >
                <EllipsisIcon className="h-4 w-4" />
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 top-10 z-50 w-48 rounded-lg border border-border bg-background py-1 shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false); /* TODO: member dialog */
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                    >
                      <UsersIcon className="h-3.5 w-3.5" /> 成员管理
                    </button>
                    <div className="my-1 border-t border-border" />
                    <button
                      type="button"
                      onClick={() => {
                        setShowMenu(false);
                        setShowDeleteConfirm(true);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                    >
                      <TrashIcon className="h-3.5 w-3.5" /> 删除 Skill
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {skill.description && <p className="text-sm text-muted-foreground">{skill.description}</p>}

        {/* Two-column layout */}
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Left: SKILL.md content */}
          <div className="flex-1 min-w-0">
            {mdLoading ? (
              <div className="flex h-[320px] items-center justify-center rounded-lg border bg-background">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : mdContent ? (
              <div className="rounded-lg border bg-background p-6 lg:p-8 prose prose-sm dark:prose-invert max-w-none">
                <Streamdown plugins={mdPlugins}>{stripFrontmatter(mdContent)}</Streamdown>
              </div>
            ) : (
              <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed bg-muted/20">
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <FileTextIcon className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="mb-1 text-sm font-medium">No SKILL.md available</p>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    This skill does not have a SKILL.md file yet.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Right: Sidebar metadata */}
          <div className="w-full lg:w-[320px] shrink-0 space-y-6">
            {/* Install command */}
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono text-sm text-foreground overflow-x-auto flex-1 whitespace-nowrap">
                  {installCmd}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md hover:bg-background hover:shadow-sm transition-all"
                >
                  {copied ? (
                    <CheckIcon className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <CopyIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>

            {/* Metadata card */}
            <div className="rounded-lg border bg-background p-4 space-y-4">
              {skill.installCount > 0 && (
                <MetadataItem label="Install Count">
                  <span className="font-semibold text-foreground flex items-center gap-1.5">
                    <DownloadIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    {skill.installCount.toLocaleString()}
                  </span>
                </MetadataItem>
              )}

              {skill.sourceUrl && (
                <MetadataItem label="Repository">
                  <a
                    href={skill.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-primary hover:underline font-medium text-sm"
                  >
                    <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{skill.sourceType ?? 'Source'}</span>
                  </a>
                </MetadataItem>
              )}

              <MetadataItem label="License">
                <span className="font-medium text-sm">{skill.license || 'MIT'}</span>
              </MetadataItem>

              <MetadataItem label="Members">
                <span className="font-medium text-sm flex items-center gap-1.5">
                  <UsersIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  {skill.members.length + 1}
                </span>
              </MetadataItem>

              <MetadataItem label="Updated">
                <span className="font-medium text-sm flex items-center gap-1.5">
                  <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                  {new Date(skill.updatedAt).toLocaleDateString()}
                </span>
              </MetadataItem>

              <MetadataItem label="Created">
                <span className="font-medium text-sm">
                  {new Date(skill.createdAt).toLocaleDateString()}
                </span>
              </MetadataItem>

              {skill.category && (
                <MetadataItem label="Category">
                  <Badge variant="secondary" className="text-xs">
                    {skill.category}
                  </Badge>
                </MetadataItem>
              )}

              {skill.tags.length > 0 && (
                <MetadataItem label="Tags">
                  <div className="flex flex-wrap gap-1.5">
                    {skill.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="px-2 py-0.5 text-xs font-normal"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </MetadataItem>
              )}
            </div>
          </div>
        </div>

        {/* Delete confirmation */}
        {showDeleteConfirm && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => setShowDeleteConfirm(false)}
          >
            <div
              className="w-full max-w-sm rounded-xl bg-background p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold">删除 Skill</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                确定要删除 &ldquo;{skill.name}&rdquo; 吗？
              </p>
              <p className="mt-1 text-xs text-destructive">
                此操作不可恢复，所有版本和收藏数据都将被永久删除。
              </p>
              <div className="mt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                >
                  {deleting && <Loader2 className="h-4 w-4 animate-spin" />} 确认删除
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Update modal */}
        <PublishSkillModal
          open={showUpdate}
          onClose={() => setShowUpdate(false)}
          onSuccess={() => void loadSkill()}
          existingSkill={{
            name: skill.name,
            description: skill.description,
            category: skill.category ?? undefined,
            tags: skill.tags,
            visibility: skill.visibility,
            latestVersion: skill.latestVersion ?? undefined,
          }}
        />
      </div>
    </div>
  );
}

function MetadataItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}
