'use client';

import {
  CopyIcon,
  EyeIcon,
  MonitorIcon,
  MoreHorizontalIcon,
  PlusCircleIcon,
  RadioIcon,
  StarIcon,
  TrashIcon,
  WifiIcon,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { McpItem } from './mcp-card';

interface McpListItemProps {
  mcp: McpItem;
  onToggle?: (mcp: McpItem) => void;
  onDelete?: (mcp: McpItem) => void;
  onClick?: (mcp: McpItem) => void;
  onInstall?: (mcp: McpItem) => void;
  onUninstall?: (mcp: McpItem) => void;
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

function getTransportLabel(transport: string) {
  switch (transport) {
    case 'stdio':
      return 'Stdio';
    case 'sse':
      return 'SSE';
    case 'streamable-http':
      return 'HTTP';
    default:
      return transport;
  }
}

export function McpListItem({ mcp, onDelete, onClick, onInstall, onUninstall }: McpListItemProps) {
  const TransportIcon = getTransportIcon(mcp.transport);
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const isInstalled = mcp.isInstalled === true;
  const starCount = mcp.starCount ?? 0;
  const isStarred = mcp.isStarred === true;

  const handleCopyConfig = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const config = { mcpServers: { [mcp.name]: { command: mcp.command, url: mcp.url } } };
      navigator.clipboard.writeText(JSON.stringify(config, null, 2));
      setCopiedConfig(true);
      setTimeout(() => setCopiedConfig(false), 2000);
    },
    [mcp]
  );

  return (
    <>
      <div
        className="group flex cursor-pointer items-center gap-4 rounded-lg border bg-background p-4 transition-colors hover:border-muted-foreground"
        onClick={() => onClick?.(mcp)}
      >
        {/* Transport icon */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
          <TransportIcon className="h-5 w-5 text-muted-foreground" />
        </div>

        {/* Name + badges + description */}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground">{mcp.name}</h3>
            {isInstalled && (
              <Badge className="bg-green-100 text-green-700 hover:bg-green-100 px-1.5 py-0 text-[10px]">
                已安装
              </Badge>
            )}
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {getTransportLabel(mcp.transport)}
            </Badge>
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {mcp.scope}
            </Badge>
            {mcp.category && (
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                {mcp.category}
              </Badge>
            )}
          </div>
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {mcp.description ||
              (mcp.transport === 'stdio' ? mcp.command : mcp.url) ||
              'No description'}
          </p>
        </div>

        {/* Tags */}
        {mcp.tags && mcp.tags.length > 0 && (
          <div className="hidden lg:flex items-center gap-1.5 shrink-0">
            {mcp.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium"
              >
                {tag}
              </span>
            ))}
            {mcp.tags.length > 2 && (
              <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium">
                +{mcp.tags.length - 2}
              </span>
            )}
          </div>
        )}

        {/* Star */}
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs transition-all duration-200 hover:scale-105 active:scale-95 shrink-0 ${isStarred ? 'font-medium text-amber-500' : 'text-muted-foreground hover:text-amber-400'}`}
        >
          <StarIcon className={`h-3.5 w-3.5 ${isStarred ? 'fill-current' : ''}`} />
          <span className="tabular-nums">{starCount}</span>
        </button>

        {/* Author */}
        {mcp.author && (
          <span className="hidden sm:block shrink-0 text-xs text-muted-foreground">
            {mcp.author}
          </span>
        )}

        {/* Dropdown menu */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent transition-colors"
          >
            <MoreHorizontalIcon className="h-4 w-4" />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div
                className="absolute right-0 top-8 z-50 w-48 rounded-lg border border-border bg-background py-1 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => {
                    onClick?.(mcp);
                    setShowMenu(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                >
                  <EyeIcon className="h-3.5 w-3.5" /> 查看详情
                </button>
                <button
                  type="button"
                  onClick={handleCopyConfig}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                >
                  <CopyIcon className="h-3.5 w-3.5" /> {copiedConfig ? '已复制' : '复制配置'}
                </button>
                {onDelete && (
                  <>
                    <div className="my-1 border-t border-border" />
                    <button
                      type="button"
                      onClick={() => {
                        setShowDeleteConfirm(true);
                        setShowMenu(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
                    >
                      <TrashIcon className="h-3.5 w-3.5" /> 删除
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* View button */}
        <button
          type="button"
          className="inline-flex items-center gap-1.5 shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onClick?.(mcp);
          }}
        >
          <EyeIcon className="h-3.5 w-3.5" /> 查看
        </button>

        {/* Install/Uninstall button */}
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${isInstalled ? 'border border-border text-destructive hover:bg-destructive/10' : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}
          onClick={(e) => {
            e.stopPropagation();
            if (isInstalled) onUninstall?.(mcp);
            else onInstall?.(mcp);
          }}
        >
          {isInstalled ? (
            <TrashIcon className="h-3.5 w-3.5" />
          ) : (
            <PlusCircleIcon className="h-3.5 w-3.5" />
          )}
          {isInstalled ? '卸载' : '安装'}
        </button>
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
            <h3 className="text-lg font-semibold">确认删除</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              确定要删除 &ldquo;{mcp.name}&rdquo; 吗？
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
                onClick={() => {
                  onDelete?.(mcp);
                  setShowDeleteConfirm(false);
                }}
                className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
