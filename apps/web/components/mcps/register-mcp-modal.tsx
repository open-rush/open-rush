'use client';

import {
  AlertCircleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { parseMcpJsonConfig, toSlug } from '@/lib/mcps/register-utils';

function extractTemplateVars(config: Record<string, unknown>): string[] {
  const vars: string[] = [];
  const str = JSON.stringify(config);
  const matches = str.matchAll(/\$\{([A-Z_][A-Z0-9_]*)}/g);
  for (const m of matches) {
    if (m[1] && !vars.includes(m[1])) vars.push(m[1]);
  }
  return vars;
}

// ---------------------------------------------------------------------------
// MCP Categories
// ---------------------------------------------------------------------------

const MCP_CATEGORIES = [
  { value: 'utilities', label: '工具' },
  { value: 'knowledge', label: '知识库' },
  { value: 'dev-tools', label: '开发工具' },
  { value: 'observability', label: '可观测性' },
  { value: 'data', label: '数据' },
  { value: 'design', label: '设计' },
  { value: 'ci-cd', label: 'CI/CD' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RegisterMcpModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function RegisterMcpModal({ open, onClose, onSuccess }: RegisterMcpModalProps) {
  // Step 1: JSON input
  const [jsonInput, setJsonInput] = useState('');
  // Step 3: Display name overrides
  const [displayNameOverrides, setDisplayNameOverrides] = useState<Record<string, string>>({});
  // Step 4: Extra config (secrets / API keys)
  const [extraConfig, setExtraConfig] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState('');
  // Step 5: Metadata
  const [description, setDescription] = useState('');
  const [author, setAuthor] = useState('');
  const [category, setCategory] = useState('utilities');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState('public');
  const [repoUrl, setRepoUrl] = useState('');
  const [docUrl, setDocUrl] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parse JSON
  const parseResult = useMemo(() => {
    if (!jsonInput.trim()) return { servers: [], error: undefined };
    return parseMcpJsonConfig(jsonInput);
  }, [jsonInput]);

  // Auto-fill display names
  useEffect(() => {
    setDisplayNameOverrides((prev) => {
      const next = { ...prev };
      for (const server of parseResult.servers) {
        if (!(server.name in next)) next[server.name] = server.displayName;
      }
      return next;
    });
  }, [parseResult.servers]);

  // Auto-detect template variables from config
  const detectedVars = useMemo(() => {
    const vars: string[] = [];
    for (const server of parseResult.servers) {
      for (const v of extractTemplateVars(server.serverConfig)) {
        if (!vars.includes(v)) vars.push(v);
      }
    }
    return vars;
  }, [parseResult.servers]);

  // Auto-add detected vars to extra config
  useEffect(() => {
    setExtraConfig((prev) => {
      const next = { ...prev };
      for (const v of detectedVars) {
        if (!(v in next)) next[v] = '';
      }
      return next;
    });
  }, [detectedVars]);

  const handleAddTag = useCallback(() => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) {
      setTags((prev) => [...prev, t]);
      setTagInput('');
    }
  }, [tagInput, tags]);

  const handleAddExtraKey = useCallback(() => {
    const k = newKey.trim().toUpperCase();
    if (k && !(k in extraConfig)) {
      setExtraConfig((prev) => ({ ...prev, [k]: '' }));
      setNewKey('');
    }
  }, [newKey, extraConfig]);

  const handleSubmit = useCallback(async () => {
    if (parseResult.servers.length === 0) {
      setError('请输入有效的 MCP 配置');
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      let successCount = 0;
      for (const server of parseResult.servers) {
        const slug = toSlug(server.name);
        const finalExtra: Record<string, string> = {};
        for (const [k, v] of Object.entries(extraConfig)) {
          if (v.trim()) finalExtra[k] = v.trim();
        }

        const payload = {
          name: slug,
          displayName: displayNameOverrides[server.name]?.trim() || server.displayName,
          description: description.trim() || `${server.displayName} MCP server`,
          transportType: server.transportType,
          serverConfig: server.serverConfig,
          tags,
          category,
          author: author.trim() || undefined,
          extraConfig: Object.keys(finalExtra).length > 0 ? finalExtra : undefined,
          visibility,
          repoUrl: repoUrl.trim() || undefined,
          docUrl: docUrl.trim() || undefined,
        };

        const res = await fetch('/api/mcps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.ok) successCount++;
        else {
          const data = await res.json();
          if (res.status !== 409) throw new Error(data.error ?? 'Failed');
        }
      }

      if (successCount > 0) {
        onSuccess();
        onClose();
        // Reset
        setJsonInput('');
        setDisplayNameOverrides({});
        setExtraConfig({});
        setDescription('');
        setTags([]);
        setAuthor('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }, [
    parseResult.servers,
    displayNameOverrides,
    extraConfig,
    description,
    author,
    category,
    tags,
    visibility,
    repoUrl,
    docUrl,
    onSuccess,
    onClose,
  ]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-[90vw] max-w-[750px] flex-col overflow-hidden rounded-xl bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">注册 MCP 服务器</h2>
              <p className="text-sm text-muted-foreground">粘贴 MCP JSON 配置进行注册</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-accent"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircleIcon className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Step 1: Paste JSON */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                1
              </span>
              <label className="text-sm font-medium">粘贴 MCP 配置</label>
            </div>
            <textarea
              rows={8}
              placeholder={`{\n  "mcpServers": {\n    "my-server": {\n      "command": "npx",\n      "args": ["-y", "mcp-server"]\n    }\n  }\n}`}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
            />
            {jsonInput.trim() && parseResult.error && (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircleIcon className="h-4 w-4 shrink-0" />
                <span>{parseResult.error}</span>
              </div>
            )}
          </div>

          {/* Step 2: Detected servers */}
          {parseResult.servers.length > 0 && (
            <div className="rounded-lg border p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-medium text-white">
                  2
                </span>
                <span className="text-sm font-medium">
                  检测到 {parseResult.servers.length} 个服务器
                </span>
              </div>
              <div className="space-y-2">
                {parseResult.servers.map((s) => (
                  <div
                    key={s.name}
                    className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2"
                  >
                    <CheckCircle2Icon className="h-4 w-4 text-green-500 shrink-0" />
                    <span className="text-sm font-medium">{s.name}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {s.transportType}
                    </Badge>
                    {s.transportType === 'stdio' && (
                      <code className="text-[10px] text-muted-foreground font-mono truncate">
                        {s.serverConfig.command as string}{' '}
                        {((s.serverConfig.args as string[]) ?? []).join(' ')}
                      </code>
                    )}
                    {s.transportType !== 'stdio' && (
                      <code className="text-[10px] text-muted-foreground font-mono truncate">
                        {s.serverConfig.url as string}
                      </code>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Display names */}
          {parseResult.servers.length > 0 && (
            <div className="rounded-lg border p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-xs font-medium text-white">
                  3
                </span>
                <span className="text-sm font-medium">确认显示名称</span>
              </div>
              {parseResult.servers.map((s) => (
                <div key={s.name} className="mb-2 last:mb-0">
                  <label className="text-xs font-medium">
                    显示名称 <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={displayNameOverrides[s.name] ?? s.displayName}
                    onChange={(e) =>
                      setDisplayNameOverrides((prev) => ({ ...prev, [s.name]: e.target.value }))
                    }
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    用户在市场中看到的名称，解析自 JSON key，可自定义
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Step 4: Secrets / API keys */}
          {parseResult.servers.length > 0 && (
            <div className="rounded-lg border p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-600 text-xs font-medium text-white">
                  4
                </span>
                <span className="text-sm font-medium">密钥配置 (可选)</span>
              </div>
              <p className="mb-3 text-xs text-muted-foreground">
                {/* biome-ignore lint/suspicious/noTemplateCurlyInString: intentional display of template syntax */}
                如果配置中使用了 {'${VAR}'} 模板变量，用户安装时需要提供这些值
              </p>
              {Object.entries(extraConfig).map(([key, value]) => (
                <div key={key} className="mb-2 flex items-center gap-2">
                  <code className="shrink-0 rounded bg-muted px-2 py-1 text-xs font-mono">
                    {key}
                  </code>
                  <input
                    type="password"
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                    value={value}
                    onChange={(e) => setExtraConfig((prev) => ({ ...prev, [key]: e.target.value }))}
                    placeholder="Default value (optional)"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setExtraConfig((prev) => {
                        const next = { ...prev };
                        delete next[key];
                        return next;
                      })
                    }
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="text"
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-mono"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="NEW_VAR_NAME"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddExtraKey();
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddExtraKey}
                  className="rounded-lg border border-border px-2 py-1.5 text-xs hover:bg-accent"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Step 5: Optional metadata */}
          {parseResult.servers.length > 0 && (
            <details className="rounded-lg border p-4">
              <summary className="flex cursor-pointer items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  5
                </span>
                <span className="text-sm font-medium">可选信息</span>
              </summary>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="text-xs font-medium">描述</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium">Author</label>
                    <input
                      type="text"
                      value={author}
                      onChange={(e) => setAuthor(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Category</label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    >
                      {MCP_CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium">Tags</label>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {tags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs"
                      >
                        {t}
                        <button
                          type="button"
                          onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <XIcon className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddTag();
                        }
                      }}
                      placeholder="Add tag..."
                      className="flex-1 min-w-[80px] rounded border-0 bg-transparent px-1 py-0.5 text-xs outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium">Visibility</label>
                    <select
                      value={visibility}
                      onChange={(e) => setVisibility(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    >
                      <option value="public">Public</option>
                      <option value="private">Private</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium">Repo URL</label>
                    <input
                      type="text"
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      placeholder="https://github.com/..."
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium">Doc URL</label>
                  <input
                    type="text"
                    value={docUrl}
                    onChange={(e) => setDocUrl(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    placeholder="https://docs.example.com"
                  />
                </div>
              </div>
            </details>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-end border-t px-6 py-4">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || parseResult.servers.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {submitting && <Loader2Icon className="h-4 w-4 animate-spin" />}
            注册 MCP 服务器
          </button>
        </div>
      </div>
    </div>
  );
}
