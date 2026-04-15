'use client';

import { ArrowLeftIcon, Loader2, RssIcon, StarIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { McpCard, type McpItem } from '@/components/mcps/mcp-card';
import { McpDetailModal } from '@/components/mcps/mcp-detail-modal';
import { type ViewMode, ViewModeToggle } from '@/components/shared/view-mode-toggle';

export default function McpStarsPage() {
  const [servers, setServers] = useState<McpItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/mcps?sortBy=star_count&limit=100');
      const json = await res.json();
      if (json.success) {
        setServers(
          (json.data.items as Array<Record<string, unknown>>)
            .filter((item) => item.isStarred === true)
            .map((item) => ({
              id: item.id as string,
              name: (item.displayName as string) || (item.name as string),
              transport: item.transportType as string,
              enabled: true,
              scope: item.visibility as string,
              description: item.description as string,
              tags: item.tags as string[],
              toolCount: (item.tools as Array<unknown>)?.length ?? 0,
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
            href="/mcps"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeftIcon className="h-4 w-4" /> MCP Servers
          </Link>
        </div>

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <StarIcon className="h-6 w-6 text-amber-500 fill-amber-500" /> My Stars
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">你收藏的 MCP Servers</p>
          </div>
          <ViewModeToggle viewMode={viewMode} onViewModeChange={setViewMode} />
        </div>

        {loading ? (
          <div className="flex h-[320px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : servers.length === 0 ? (
          <div className="flex h-[320px] flex-col items-center justify-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <RssIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium">还没有收藏 MCP Servers</h3>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {servers.map((mcp) => (
              <McpCard key={mcp.id} mcp={mcp} onClick={(m) => setDetailId(m.id)} />
            ))}
          </div>
        )}
      </div>
      <McpDetailModal mcpId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
