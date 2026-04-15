'use client';

import { CheckIcon, CopyIcon, EyeIcon, LockIcon, RefreshCwIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { SkillItem } from './skill-card';
import { StarButton } from './star-button';

interface SkillListItemProps {
  skill: SkillItem;
  onUpdate?: (skill: SkillItem) => void;
  onClick?: (skill: SkillItem) => void;
}

export function SkillListItem({ skill, onUpdate, onClick }: SkillListItemProps) {
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
      className="group flex cursor-pointer items-center gap-4 rounded-lg border bg-background p-4 transition-colors hover:border-muted-foreground"
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
      {/* Name + description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-1">
          <h3 className="text-sm font-semibold text-foreground">{skill.name}</h3>
          {isPrivate && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              <LockIcon className="h-2.5 w-2.5" /> Private
            </span>
          )}
          {skill.version && (
            <span className="text-xs text-muted-foreground">{skill.version.replace(/^v/, '')}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground line-clamp-1">
          {skill.description || skill.source}
        </p>
      </div>

      {/* Tags */}
      {skill.tags && skill.tags.length > 0 && (
        <div className="hidden lg:flex items-center gap-1.5 shrink-0">
          {skill.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium"
            >
              {tag}
            </span>
          ))}
          {skill.tags.length > 2 && (
            <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium">
              +{skill.tags.length - 2}
            </span>
          )}
        </div>
      )}

      {/* Install command + copy */}
      <div className="hidden md:flex items-center gap-2 shrink-0 p-1.5 rounded-md bg-muted/50 border border-border">
        <code className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
          {installCmd}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? (
            <CheckIcon className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <CopyIcon className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Metadata */}
      <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 whitespace-nowrap">
        <span>{skill.visibility}</span>
        {skill.installCount ? (
          <>
            <span>•</span>
            <span>{skill.installCount} installs</span>
          </>
        ) : null}
      </div>

      {/* Update button */}
      {onUpdate && (
        <button
          type="button"
          className="inline-flex items-center gap-1 shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onUpdate(skill);
          }}
        >
          <RefreshCwIcon className="h-3 w-3" /> 更新
        </button>
      )}

      {/* Star */}
      <StarButton
        skillName={skill.name}
        initialCount={skill.starCount ?? 0}
        initialStarred={skill.isStarred ?? false}
        size="sm"
      />

      {/* View button */}
      <button
        type="button"
        className="inline-flex items-center gap-1.5 shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(skill);
        }}
      >
        <EyeIcon className="h-3.5 w-3.5" /> 查看
      </button>
    </div>
  );
}
