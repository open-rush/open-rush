'use client';

import { ArrowLeftIcon, Loader2, PlusIcon, RssIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { McpCard, type McpItem } from '@/components/mcps/mcp-card';
import { McpDetailModal } from '@/components/mcps/mcp-detail-modal';
import { RegisterMcpModal } from '@/components/mcps/register-mcp-modal';
import { type ViewMode, ViewModeToggle } from '@/components/shared/view-mode-toggle';

type TabFilter = 'all' | 'public' | 'private';

export default function MyMcpPage() {
  const [servers, setServers] = useState<McpItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [showRegister, setShowRegister] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Load all MCPs owned by current user
      const res = await fetch('/api/mcps?limit=200');
      const json = await res.json();
      if (json.success) {
        setServers(
          (json.data.items as Array<Record<string, unknown>>).map((item) => ({
            id: item.id as string,
            name: (item.displayName as string) || (item.name as string),
            transport: item.transportType as string,
            command: (item.serverConfig as Record<string, unknown>)?.command as string,
            url: (item.serverConfig as Record<string, unknown>)?.url as string,
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

  const handleDelete = useCallback(
    async (mcp: McpItem) => {
      try {
        await fetch(`/api/mcps/${mcp.id}`, { method: 'DELETE' });
        void load();
      } catch {
        /* silent */
      }
    },
    [load]
  );

  const filtered = tab === 'all' ? servers : servers.filter((s) => s.scope === tab);

  const counts = {
    all: servers.length,
    public: servers.filter((s) => s.scope === 'public').length,
    private: servers.filter((s) => s.scope === 'private').length,
  };

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
            <h1 className="text-2xl font-bold tracking-tight">My MCPs</h1>
            <p className="mt-1 text-sm text-muted-foreground">你创建和管理的 MCP Servers</p>
          </div>
          <div className="flex items-center gap-2">
            <ViewModeToggle viewMode={viewMode} onViewModeChange={setViewMode} />
            <button
              type="button"
              onClick={() => setShowRegister(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <PlusIcon className="h-4 w-4" /> New MCP
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex items-center gap-4 border-b border-border">
          {(['all', 'public', 'private'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {t === 'all' ? 'All' : t === 'public' ? 'Public' : 'Private'} ({counts[t]})
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex h-[320px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-[320px] flex-col items-center justify-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <RssIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium">
              {tab === 'all' ? '还没有创建 MCP Servers' : `没有 ${tab} 的 MCP Servers`}
            </h3>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((mcp) => (
              <McpCard
                key={mcp.id}
                mcp={mcp}
                onDelete={handleDelete}
                onClick={(m) => setDetailId(m.id)}
              />
            ))}
          </div>
        )}
      </div>
      <RegisterMcpModal
        open={showRegister}
        onClose={() => setShowRegister(false)}
        onSuccess={() => void load()}
      />
      <McpDetailModal mcpId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
