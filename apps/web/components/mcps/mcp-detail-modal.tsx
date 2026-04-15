'use client';

import {
  CalendarIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  MonitorIcon,
  RadioIcon,
  TagIcon,
  WifiIcon,
  WrenchIcon,
  XIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';

interface McpDetail {
  id: string;
  name: string;
  displayName: string;
  description: string;
  transportType: string;
  serverConfig: Record<string, unknown>;
  tools: Array<{ name: string; description: string }>;
  tags: string[];
  category: string | null;
  author: string | null;
  docUrl: string | null;
  repoUrl: string | null;
  readme: string | null;
  starCount: number;
  isBuiltin: boolean;
  visibility: string;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  isStarred?: boolean;
  isInstalled?: boolean;
}

interface McpDetailModalProps {
  mcpId: string | null;
  onClose: () => void;
}

function getTransportIcon(transport: string) {
  switch (transport) {
    case 'stdio':
      return MonitorIcon;
    case 'sse':
      return RadioIcon;
    default:
      return WifiIcon;
  }
}

export function McpDetailModal({ mcpId, onClose }: McpDetailModalProps) {
  const [mcp, setMcp] = useState<McpDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);

  useEffect(() => {
    if (!mcpId) {
      setMcp(null);
      return;
    }
    setLoading(true);
    fetch(`/api/mcps/${mcpId}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setMcp(json.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [mcpId]);

  const handleCopyConfig = useCallback(() => {
    if (!mcp) return;
    const config = { mcpServers: { [mcp.name]: mcp.serverConfig } };
    navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 2000);
  }, [mcp]);

  if (!mcpId) return null;

  const TransportIcon = mcp ? getTransportIcon(mcp.transportType) : MonitorIcon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[85vh] w-full max-w-[700px] flex-col overflow-hidden rounded-xl bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 border-b px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950">
              <TransportIcon className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{mcp?.displayName ?? 'Loading...'}</h2>
              {mcp && <p className="text-xs text-muted-foreground">{mcp.name}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              Loading...
            </div>
          ) : mcp ? (
            <>
              {/* Badges */}
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="gap-1">
                  <TransportIcon className="h-3 w-3" />
                  {mcp.transportType}
                </Badge>
                {mcp.isBuiltin && <Badge variant="secondary">内置</Badge>}
                {mcp.isInstalled && <Badge className="bg-green-100 text-green-700">已安装</Badge>}
                <Badge variant="outline">{mcp.visibility}</Badge>
                {mcp.category && <Badge variant="outline">{mcp.category}</Badge>}
                {mcp.source && <Badge variant="outline">{mcp.source}</Badge>}
              </div>

              {/* Description */}
              <p className="text-sm text-foreground/80 leading-relaxed">{mcp.description}</p>

              {/* Config */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium">Server Config</h3>
                  <button
                    type="button"
                    onClick={handleCopyConfig}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors"
                  >
                    {copiedConfig ? (
                      <CheckIcon className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <CopyIcon className="h-3.5 w-3.5" />
                    )}
                    {copiedConfig ? 'Copied' : 'Copy Config'}
                  </button>
                </div>
                <pre className="rounded-lg border border-border bg-muted/30 p-4 text-xs font-mono overflow-x-auto">
                  {JSON.stringify({ mcpServers: { [mcp.name]: mcp.serverConfig } }, null, 2)}
                </pre>
              </div>

              {/* Tools */}
              {mcp.tools.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                    <WrenchIcon className="h-4 w-4 text-muted-foreground" />
                    Tools ({mcp.tools.length})
                  </h3>
                  <div className="rounded-lg border border-border divide-y divide-border">
                    {mcp.tools.map((tool) => (
                      <div key={tool.name} className="px-4 py-2.5">
                        <div className="text-sm font-medium font-mono">{tool.name}</div>
                        {tool.description && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {tool.description}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tags */}
              {mcp.tags.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                    <TagIcon className="h-3 w-3" />
                    Tags
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {mcp.tags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div className="rounded-lg border border-border divide-y divide-border text-xs">
                {mcp.author && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-muted-foreground">Author</span>
                    <span className="font-medium">{mcp.author}</span>
                  </div>
                )}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-muted-foreground">Stars</span>
                  <span className="font-medium">{mcp.starCount}</span>
                </div>
                {mcp.repoUrl && (
                  <div className="px-4 py-2.5">
                    <span className="text-muted-foreground block mb-1">Repository</span>
                    <a
                      href={mcp.repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-1"
                    >
                      <ExternalLinkIcon className="h-3 w-3" />
                      {mcp.repoUrl}
                    </a>
                  </div>
                )}
                {mcp.docUrl && (
                  <div className="px-4 py-2.5">
                    <span className="text-muted-foreground block mb-1">Documentation</span>
                    <a
                      href={mcp.docUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-1"
                    >
                      <ExternalLinkIcon className="h-3 w-3" />
                      {mcp.docUrl}
                    </a>
                  </div>
                )}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-muted-foreground">Updated</span>
                  <span className="font-medium flex items-center gap-1.5">
                    <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                    {new Date(mcp.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              MCP not found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
