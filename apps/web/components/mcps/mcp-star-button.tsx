'use client';

import { StarIcon } from 'lucide-react';
import { useCallback, useState } from 'react';

interface McpStarButtonProps {
  mcpId: string;
  initialCount: number;
  initialStarred?: boolean;
  size?: 'sm' | 'md';
}

export function McpStarButton({
  mcpId,
  initialCount,
  initialStarred = false,
  size = 'sm',
}: McpStarButtonProps) {
  const [starred, setStarred] = useState(initialStarred);
  const [count, setCount] = useState(initialCount);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setStarred(!starred);
    setCount(starred ? count - 1 : count + 1);

    try {
      const res = await fetch(`/api/mcps/${mcpId}/star`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setStarred(json.data.starred);
        setCount(json.data.starCount);
      }
    } catch {
      setStarred(starred);
      setCount(count);
    } finally {
      setLoading(false);
    }
  }, [loading, starred, count, mcpId]);

  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void toggle();
      }}
      className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 ${textSize} transition-all duration-200 hover:scale-105 active:scale-95 ${starred ? 'font-medium text-amber-500 hover:text-amber-600' : 'text-muted-foreground hover:text-amber-400'}`}
      aria-label={starred ? '取消收藏' : '收藏'}
    >
      <StarIcon
        className={`${iconSize} transition-all duration-200 ${starred ? 'fill-current' : ''}`}
      />
      <span className="tabular-nums">{count}</span>
    </button>
  );
}
