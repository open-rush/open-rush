'use client';

import { ArrowLeftIcon, Loader2, StarIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { type ViewMode, ViewModeToggle } from '@/components/shared/view-mode-toggle';
import { SkillCard, type SkillItem } from '@/components/skills/skill-card';
import { SkillListItem } from '@/components/skills/skill-list-item';

export default function SkillStarsPage() {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/skills?sortBy=star_count&limit=100');
      const json = await res.json();
      if (json.success) {
        setSkills(
          (json.data.items as Array<Record<string, unknown>>)
            .filter((item) => item.isStarred === true)
            .map((item) => ({
              name: item.name as string,
              source: item.name as string,
              visibility: item.visibility as string,
              enabled: true,
              description: item.description as string,
              tags: item.tags as string[],
              version: item.latestVersion as string,
              starCount: item.starCount as number,
              isStarred: true,
            }))
        );
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-8 py-8">
        <div className="mb-6">
          <Link
            href="/skills"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeftIcon className="h-4 w-4" /> Skills
          </Link>
        </div>

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <StarIcon className="h-6 w-6 text-amber-500 fill-amber-500" /> My Stars
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">你收藏的 Skills</p>
          </div>
          <ViewModeToggle viewMode={viewMode} onViewModeChange={setViewMode} />
        </div>

        {loading ? (
          <div className="flex h-[320px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : skills.length === 0 ? (
          <div className="flex h-[320px] flex-col items-center justify-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <StarIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium">还没有收藏 Skills</h3>
            <p className="mt-1 text-xs text-muted-foreground">在 Skills 市场中点击星标收藏</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {skills.map((s) => (
              <SkillCard key={s.name} skill={s} />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {skills.map((s) => (
              <SkillListItem key={s.name} skill={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
