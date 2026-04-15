'use client';

import { FolderIcon, Loader2, PlusIcon, PuzzleIcon, RefreshCwIcon, StarIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ListPagination } from '@/components/shared/list-pagination';
import { SearchInput } from '@/components/shared/search-input';
import { CreateGroupModal } from '@/components/skills/create-group-modal';
import { PublishSkillModal } from '@/components/skills/publish-skill-modal';
import type { SkillItem } from '@/components/skills/skill-card';
import { SkillCategoryFilter } from '@/components/skills/skill-category-filter';
import { SkillListItem } from '@/components/skills/skill-list-item';

interface SkillGroup {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: string;
}

type TabType = 'skills' | 'groups';

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [groups, setGroups] = useState<SkillGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabType>('skills');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [sortBy, setSortBy] = useState('updated_at');
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);
  const [showPublish, setShowPublish] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset), sortBy });
      if (search) params.set('search', search);
      if (category !== 'all') params.set('category', category);

      const res = await fetch(`/api/skills?${params}`);
      const json = await res.json();
      if (json.success) {
        setSkills(
          json.data.items.map((item: Record<string, unknown>) => ({
            name: item.name as string,
            source: item.name as string,
            visibility: item.visibility as string,
            enabled: true,
            description: item.description as string,
            tags: item.tags as string[],
            version: item.latestVersion as string,
            starCount: item.starCount as number,
            isStarred: item.isStarred as boolean,
          }))
        );
        setTotal(json.data.total);
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [limit, offset, sortBy, search, category]);

  const loadGroups = useCallback(async () => {
    try {
      const res = await fetch('/api/skill-groups');
      const json = await res.json();
      if (json.success) setGroups(json.data);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    void loadSkills();
    void loadGroups();
  }, [loadSkills, loadGroups]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-8 py-8">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Skills</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              浏览和管理 Groups 与 Skills，用于增强 Agent 能力
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void loadSkills();
                void loadGroups();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              <RefreshCwIcon className="h-4 w-4" /> Sync
            </button>
            <Link
              href="/skills/stars"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              <StarIcon className="h-4 w-4" /> My Stars
            </Link>
            <button
              type="button"
              onClick={() => setShowCreateGroup(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              <FolderIcon className="h-4 w-4" /> Create Group
            </button>
            <button
              type="button"
              onClick={() => setShowPublish(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <PlusIcon className="h-4 w-4" /> Add Skill
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex items-center gap-4 border-b border-border">
          <button
            type="button"
            onClick={() => setTab('skills')}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${tab === 'skills' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            Skills ({total})
          </button>
          <button
            type="button"
            onClick={() => setTab('groups')}
            className={`pb-2 text-sm font-medium border-b-2 transition-colors ${tab === 'groups' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            Groups ({groups.length})
          </button>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SearchInput
            placeholder="搜索..."
            value={search}
            onChange={(v) => {
              setSearch(v);
              setOffset(0);
            }}
          />
          {tab === 'skills' && (
            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value);
                setOffset(0);
              }}
              className="h-9 rounded-lg border-0 bg-muted px-3 text-sm shadow-none hover:bg-muted/80 focus-visible:outline-none transition-all"
            >
              <option value="updated_at">Latest</option>
              <option value="star_count">Most Stars</option>
              <option value="install_count">Most Installs</option>
              <option value="name">Name</option>
            </select>
          )}
        </div>

        {tab === 'skills' && (
          <div className="mb-6">
            <SkillCategoryFilter
              value={category}
              onChange={(v) => {
                setCategory(v);
                setOffset(0);
              }}
            />
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex h-[320px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : tab === 'skills' ? (
          skills.length === 0 ? (
            <div className="flex h-[320px] flex-col items-center justify-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <PuzzleIcon className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-sm font-medium">
                {search || category !== 'all' ? '没有找到匹配的 Skills' : '还没有 Skills'}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">点击 Add Skill 发布第一个</p>
            </div>
          ) : (
            <div className="space-y-2">
              {skills.map((s) => (
                <SkillListItem
                  key={s.name}
                  skill={s}
                  onClick={(sk) =>
                    (window.location.href = `/skills/${encodeURIComponent(sk.name)}`)
                  }
                />
              ))}
            </div>
          )
        ) : groups.length === 0 ? (
          <div className="flex h-[320px] flex-col items-center justify-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <FolderIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium">还没有 Groups</h3>
            <p className="mt-1 text-xs text-muted-foreground">点击 Create Group 创建第一个</p>
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map((g) => (
              <div
                key={g.id}
                className="flex items-center gap-4 rounded-lg border bg-background p-4 hover:border-muted-foreground cursor-pointer transition-colors"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-amber-50 dark:bg-amber-950">
                  <FolderIcon className="h-5 w-5 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-sm font-semibold">{g.name}</h3>
                    <span className="text-xs font-mono text-muted-foreground">{g.slug}</span>
                    <span className="inline-flex items-center rounded-md bg-secondary px-1.5 py-0.5 text-[10px]">
                      {g.visibility}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-1">
                    {g.description || 'No description'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'skills' && total > limit && (
          <ListPagination
            total={total}
            limit={limit}
            offset={offset}
            onPageChange={setOffset}
            onLimitChange={(l) => {
              setLimit(l);
              setOffset(0);
            }}
          />
        )}
      </div>

      <PublishSkillModal
        open={showPublish}
        onClose={() => setShowPublish(false)}
        onSuccess={() => void loadSkills()}
      />
      <CreateGroupModal
        open={showCreateGroup}
        onClose={() => setShowCreateGroup(false)}
        onSuccess={() => void loadGroups()}
      />
    </div>
  );
}
