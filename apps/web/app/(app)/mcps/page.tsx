'use client';

import { Loader2, PlusIcon, RefreshCwIcon, RssIcon, StarIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { McpItem } from '@/components/mcps/mcp-card';
import { McpDetailModal } from '@/components/mcps/mcp-detail-modal';
import { McpListItem } from '@/components/mcps/mcp-list-item';
import { RegisterMcpModal } from '@/components/mcps/register-mcp-modal';
import { ListPagination } from '@/components/shared/list-pagination';
import { SearchInput } from '@/components/shared/search-input';

const MCP_CATEGORIES = [
  { value: 'all', label: '全部' },
  { value: 'knowledge', label: '知识库' },
  { value: 'dev-tools', label: '开发工具' },
  { value: 'observability', label: '可观测性' },
  { value: 'data', label: '数据' },
  { value: 'design', label: '设计' },
  { value: 'ci-cd', label: 'CI/CD' },
  { value: 'utilities', label: '工具' },
];

export default function McpServersPage() {
  const [servers, setServers] = useState<McpItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [transportFilter, setTransportFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('updated_at');
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);
  const [showRegister, setShowRegister] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset), sortBy });
      if (search) params.set('search', search);
      if (transportFilter !== 'all') params.set('transportType', transportFilter);
      if (categoryFilter !== 'all') params.set('category', categoryFilter);

      const res = await fetch(`/api/mcps?${params}`);
      const json = await res.json();
      if (json.success) {
        setServers(
          json.data.items.map((item: Record<string, unknown>) => ({
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
            starCount: item.starCount as number,
            isStarred: item.isStarred as boolean,
            isInstalled: item.isInstalled as boolean,
            category: item.category as string,
          }))
        );
        setTotal(json.data.total);
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [limit, offset, sortBy, search, transportFilter, categoryFilter]);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  const handleDelete = useCallback(
    async (mcp: McpItem) => {
      try {
        await fetch(`/api/mcps/${mcp.id}`, { method: 'DELETE' });
        void loadServers();
      } catch {
        /* silent */
      }
    },
    [loadServers]
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-8 py-8">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">MCP Servers</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              浏览和管理 MCP 服务器，用于扩展 AI 能力
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadServers()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              <RefreshCwIcon className="h-4 w-4" /> Sync
            </button>
            <Link
              href="/mcps/stars"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              <StarIcon className="h-4 w-4" /> My Stars
            </Link>
            <button
              type="button"
              onClick={() => setShowRegister(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <PlusIcon className="h-4 w-4" /> Register MCP
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SearchInput
            placeholder="搜索 MCP Servers..."
            value={search}
            onChange={(v) => {
              setSearch(v);
              setOffset(0);
            }}
          />
          <select
            value={transportFilter}
            onChange={(e) => {
              setTransportFilter(e.target.value);
              setOffset(0);
            }}
            className="h-9 rounded-lg border-0 bg-muted px-3 text-sm shadow-none hover:bg-muted/80 focus-visible:outline-none transition-all"
          >
            <option value="all">All Transports</option>
            <option value="stdio">Stdio</option>
            <option value="sse">SSE</option>
            <option value="http">HTTP</option>
          </select>
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
            <option value="name">Name</option>
          </select>
        </div>

        {/* Category filter */}
        <div className="mb-6 flex flex-wrap gap-1.5">
          {MCP_CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              type="button"
              onClick={() => {
                setCategoryFilter(cat.value);
                setOffset(0);
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${categoryFilter === cat.value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex h-[320px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : servers.length === 0 ? (
          <div className="flex h-[320px] flex-col items-center justify-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <RssIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium">
              {search || transportFilter !== 'all' || categoryFilter !== 'all'
                ? '没有找到匹配的 MCP Servers'
                : '还没有注册 MCP Servers'}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              点击 Register MCP 添加新的 MCP 服务器
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {servers.map((mcp) => (
              <McpListItem
                key={mcp.id}
                mcp={mcp}
                onDelete={handleDelete}
                onClick={(m) => setDetailId(m.id)}
              />
            ))}
          </div>
        )}

        {total > limit && (
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

      <RegisterMcpModal
        open={showRegister}
        onClose={() => setShowRegister(false)}
        onSuccess={() => void loadServers()}
      />
      <McpDetailModal mcpId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
