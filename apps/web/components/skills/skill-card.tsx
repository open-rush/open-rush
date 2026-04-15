'use client';

import {
  CheckIcon,
  CopyIcon,
  LockIcon,
  PuzzleIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
} from 'lucide-react';
import { useCallback, useState } from 'react';

export interface SkillItem {
  name: string;
  source: string;
  visibility: string;
  enabled: boolean;
  metadata?: string | null;
  description?: string;
  tags?: string[];
  version?: string;
  starCount?: number;
  isStarred?: boolean;
  installCount?: number;
}

interface SkillCardProps {
  skill: SkillItem;
  onToggle?: (skill: SkillItem) => void;
  onClick?: (skill: SkillItem) => void;
}

export function SkillCard({ skill, onToggle, onClick }: SkillCardProps) {
  const [copied, setCopied] = useState(false);
  const isPrivate = skill.visibility === 'private';
  const installCmd = `reskill install ${skill.source}`;

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(installCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
    [installCmd]
  );

  return (
    <div
      className="group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-xl bg-background p-5 shadow-[0px_0px_15px_rgba(0,0,0,0.09)] transition-all duration-200 hover:shadow-[0px_0px_20px_rgba(0,0,0,0.15)] hover:scale-[0.98] motion-reduce:transform-none dark:shadow-[0px_0px_15px_rgba(0,0,0,0.3)]"
      onClick={() => onClick?.(skill)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.(skill);
        }
      }}
      role="button"
      tabIndex={0}
    >
      {/* Corner decoration */}
      <div
        className={`absolute right-0 top-0 h-12 w-12 ${isPrivate ? 'bg-amber-500' : 'bg-violet-500'}`}
        style={{ clipPath: 'polygon(100% 0, 0 0, 100% 100%)' }}
      />
      <div className="absolute right-1.5 top-1.5 z-10">
        {isPrivate ? (
          <LockIcon className="h-4 w-4 text-white/90" />
        ) : (
          <PuzzleIcon className="h-4 w-4 text-white/90" />
        )}
      </div>

      {/* Header */}
      <div className="mb-3 pr-10">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground truncate">{skill.name}</h3>
          {skill.version && (
            <span className="text-xs text-muted-foreground shrink-0 ml-2">
              {skill.version.replace(/^v/, '')}
            </span>
          )}
        </div>
        <p className="line-clamp-2 text-xs leading-relaxed text-foreground/60">
          {skill.description || skill.source}
        </p>
      </div>

      {/* Tags */}
      {skill.tags && skill.tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {skill.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium"
            >
              {tag}
            </span>
          ))}
          {skill.tags.length > 3 && (
            <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium">
              +{skill.tags.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Install command */}
      <div className="mb-3 flex items-center gap-2 rounded-md border border-border bg-muted/50 p-2">
        <code className="flex-1 truncate text-xs font-mono text-muted-foreground/80">
          {installCmd}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          {copied ? (
            <CheckIcon className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <CopyIcon className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground/70">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center rounded-md bg-secondary px-1.5 py-0.5 text-[10px]">
            {skill.visibility}
          </span>
          {skill.enabled ? (
            <span className="text-green-600 text-[10px]">Enabled</span>
          ) : (
            <span className="text-muted-foreground text-[10px]">Disabled</span>
          )}
        </div>
        {onToggle && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(skill);
            }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {skill.enabled ? (
              <ToggleRightIcon className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <ToggleLeftIcon className="h-3.5 w-3.5" />
            )}
            {skill.enabled ? 'Disable' : 'Enable'}
          </button>
        )}
      </div>
    </div>
  );
}
