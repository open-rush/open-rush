'use client';

import type { UIMessage } from 'ai';
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Code,
  ExternalLink,
  FileText,
  Lock,
  Maximize2,
  Paperclip,
  RefreshCw,
  Square,
} from 'lucide-react';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { PartRenderer } from '@/components/ai-elements/part-renderer';
import { LoadingDots } from '@/components/ui/loading-dots';
import { useChatAutoSave } from '@/hooks/use-chat-auto-save';
import { useStreamHeartbeat } from '@/hooks/use-stream-heartbeat';
import { useStreamRecovery } from '@/hooks/use-stream-recovery';
import { applyAssistantTextChunk, isStreamError, readRunSseStream } from '@/lib/run-chat-stream';
import { cn } from '@/lib/utils';

type PreviewTab = 'preview' | 'code' | 'files';

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error';

function seqStorageKey(runId: string) {
  return `lux:lastEventSeq:${runId}`;
}

function getUserText(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

function buildRecoveryMessages(
  loaded: UIMessage[],
  run: { id: string; prompt: string }
): UIMessage[] {
  const out = [...loaded];
  while (out.length > 0 && out[out.length - 1].role === 'assistant') {
    out.pop();
  }
  const last = out[out.length - 1];
  const lastUserText = last?.role === 'user' ? getUserText(last) : '';
  if (lastUserText !== run.prompt) {
    out.push({
      id: `user-${run.id}`,
      role: 'user',
      parts: [{ type: 'text', text: run.prompt }],
    });
  }
  out.push({
    id: `asst-${run.id}`,
    role: 'assistant',
    parts: [{ type: 'text', text: '' }],
  });
  return out;
}

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();

  const projectId = searchParams.get('projectId') ?? undefined;
  const taskId = searchParams.get('taskId') ?? undefined;
  const conversationId = params.id;
  const agentId = searchParams.get('agentId') ?? undefined;
  const agentName = searchParams.get('agent') || 'Builder';
  const initialPrompt = searchParams.get('prompt')?.trim() ?? '';

  const [providerLabel, setProviderLabel] = useState('Claude Code');
  useEffect(() => {
    let cancelled = false;
    const runtimeLabels: Record<string, string> = {
      'claude-code': 'Claude Code',
    };
    const backendLabels: Record<string, string> = {
      bedrock: 'Bedrock',
      anthropic: 'Anthropic API',
      custom: 'Custom Endpoint',
    };

    Promise.all([
      // v1: GET /api/v1/agent-definitions/:id → { data: { providerType, ... } }
      agentId
        ? fetch(`/api/v1/agent-definitions/${encodeURIComponent(agentId)}`).then((r) =>
            r.ok ? r.json() : null
          )
        : null,
      fetch('/api/health').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([agentJson, healthJson]) => {
        if (cancelled) return;
        const runtime = runtimeLabels[agentJson?.data?.providerType] ?? 'Claude Code';
        const backend = backendLabels[healthJson?.provider] ?? '';
        setProviderLabel(backend ? `${runtime} · ${backend}` : runtime);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('ready');
  const [error, setError] = useState<Error | null>(null);

  const currentRunIdRef = useRef<string | null>(null);
  const lastEventSeqRef = useRef(-1);
  const streamAbortRef = useRef<AbortController | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const consumeRunStream = useCallback(
    async (runId: string, afterSeq: number) => {
      // Always end any in-flight stream first. A previous run can hold the connection for minutes
      // (server polls run_events); without this, new sends / heartbeat resume no-op.
      streamAbortRef.current?.abort();
      const ac = new AbortController();
      streamAbortRef.current = ac;
      currentRunIdRef.current = runId;

      setStatus('streaming');
      const assistantId = `asst-${runId}`;

      try {
        const headers: Record<string, string> = {};
        if (afterSeq >= 0) {
          headers['Last-Event-ID'] = String(afterSeq);
        }

        // v1 SSE: /api/v1/agents/:agentId/runs/:runId/events
        // The `agentId` here = v1 Agent (legacy `taskId`); URL requires it as parent.
        const parentAgentId = taskId;
        if (!parentAgentId) throw new Error('Missing parent Agent (taskId) for SSE stream');
        const res = await fetch(
          `/api/v1/agents/${encodeURIComponent(parentAgentId)}/runs/${encodeURIComponent(runId)}/events`,
          {
            signal: ac.signal,
            headers,
          }
        );

        if (!res.ok) {
          throw new Error(`Stream failed: ${res.status}`);
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response body');

        for await (const ev of readRunSseStream(reader)) {
          if (ev.done) {
            sessionStorage.removeItem(seqStorageKey(runId));
            if (currentRunIdRef.current === runId) {
              setStatus('ready');
            }
            break;
          }

          // Check for run-level error events
          const streamErr = isStreamError(ev.payload);
          if (streamErr) {
            setError(new Error(streamErr));
            setMessages((prev) => prev.filter((m) => m.id !== assistantId));
            setStatus('error');
            continue;
          }

          lastEventSeqRef.current = ev.seq;
          sessionStorage.setItem(seqStorageKey(runId), String(ev.seq));
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === assistantId);
            const curText =
              idx >= 0 && prev[idx].parts[0]?.type === 'text' ? prev[idx].parts[0].text : '';
            const nextText = applyAssistantTextChunk(curText, ev.payload);
            if (idx === -1) {
              return [
                ...prev,
                {
                  id: assistantId,
                  role: 'assistant',
                  parts: [{ type: 'text', text: nextText }],
                },
              ];
            }
            const cur = prev[idx];
            const next = [...prev];
            next[idx] = {
              ...cur,
              parts: [{ type: 'text', text: nextText }],
            };
            return next;
          });
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          if (currentRunIdRef.current === runId) {
            setStatus('ready');
          }
        } else {
          setError(e instanceof Error ? e : new Error(String(e)));
          setStatus('error');
        }
      }
    },
    [taskId]
  );

  const consumeRunStreamRef = useRef(consumeRunStream);
  consumeRunStreamRef.current = consumeRunStream;

  const { isDisconnect, resetDisconnect } = useStreamRecovery();

  const resumeAfterDisconnect = useCallback(() => {
    resetDisconnect();
    const rid = currentRunIdRef.current;
    if (!rid) return;
    const seq = lastEventSeqRef.current;
    void consumeRunStreamRef.current(rid, seq);
  }, [resetDisconnect]);

  useStreamHeartbeat(projectId, status, isDisconnect, resumeAfterDisconnect, {
    enabled: Boolean(taskId && projectId && messages.length > 0),
    interval: 1500,
    maxRetries: 5,
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  const startRun = useCallback(
    async (text: string) => {
      if (!projectId || !taskId) {
        setError(new Error('缺少 projectId 或 taskId，请从首页进入聊天。'));
        setStatus('error');
        return;
      }
      clearError();
      setStatus('submitted');

      const userMsgId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        {
          id: userMsgId,
          role: 'user',
          parts: [{ type: 'text', text }],
        },
        {
          id: 'pending-asst',
          role: 'assistant',
          parts: [{ type: 'text', text: '' }],
        },
      ]);

      try {
        // v1: POST /api/v1/agents/:agentId/runs (parent = v1 Agent, i.e. legacy taskId).
        // v1 allows concurrent runs on an Agent; the legacy "409 with activeRunId"
        // retry path is dropped. A terminal Agent (completed/cancelled) returns
        // 409 VERSION_CONFLICT — surfaced below.
        const res = await fetch(`/api/v1/agents/${encodeURIComponent(taskId)}/runs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Idempotency-Key: give the same send a 24h dedupe window so accidental
            // double-click doesn't spawn duplicate runs. See specs §幂等性.
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({ input: text }),
        });

        const body = (await res.json()) as {
          data?: { id?: string };
          error?: { code?: string; message?: string };
        };

        if (!res.ok || !body.data?.id) {
          const msg = body.error?.message ?? `Failed to create run (HTTP ${res.status})`;
          setMessages((prev) => prev.filter((m) => m.id !== userMsgId && m.id !== 'pending-asst'));
          setStatus('error');
          setError(new Error(msg));
          return;
        }

        const runId = body.data.id;
        currentRunIdRef.current = runId;
        setMessages((prev) =>
          prev.map((m) => (m.id === 'pending-asst' ? { ...m, id: `asst-${runId}` } : m))
        );

        lastEventSeqRef.current = -1;
        await consumeRunStreamRef.current(runId, -1);
      } catch (e) {
        setMessages((prev) => prev.filter((m) => m.id !== userMsgId && m.id !== 'pending-asst'));
        setError(e instanceof Error ? e : new Error(String(e)));
        setStatus('error');
      }
    },
    [projectId, taskId, clearError]
  );

  const stopRun = useCallback(async () => {
    streamAbortRef.current?.abort();
    const rid = currentRunIdRef.current;
    if (rid && taskId) {
      // v1: POST /api/v1/agents/:agentId/runs/:runId/cancel (parent = v1 Agent = taskId).
      await fetch(
        `/api/v1/agents/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(rid)}/cancel`,
        { method: 'POST' }
      ).catch(() => {});
    }
    setStatus('ready');
  }, [taskId]);

  const loadedConvRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId || conversationId === loadedConvRef.current) return;
    loadedConvRef.current = conversationId;

    // If there's an initialPrompt, the initialPrompt effect will handle
    // sending and stream consumption. Skip auto-attach here to avoid
    // racing with it (both call consumeRunStream which aborts the other).
    const hasInitialPrompt = Boolean(initialPrompt);

    let cancelled = false;

    void (async () => {
      const msgRes = await fetch(`/api/chat/${encodeURIComponent(conversationId)}/messages`).then(
        (r) => r.json()
      );
      const loaded = (
        msgRes.success && Array.isArray(msgRes.data) ? msgRes.data : []
      ) as UIMessage[];

      if (cancelled) return;

      if (!taskId || !projectId) {
        setMessages(loaded);
        return;
      }

      // When there's an initialPrompt, just load messages — don't attach to a stream.
      if (hasInitialPrompt && loaded.length === 0) {
        setMessages(loaded);
        return;
      }

      // v1: GET /api/v1/agents/:id (task = v1 Agent). Envelope is `{ data }`.
      const tr = await fetch(`/api/v1/agents/${encodeURIComponent(taskId)}`).then((r) => r.json());
      if (cancelled || !tr.data?.activeRunId) {
        setMessages(loaded);
        return;
      }

      const activeRunId: string = tr.data.activeRunId;
      // v1: GET /api/v1/agents/:agentId/runs/:runId.
      const runRes = await fetch(
        `/api/v1/agents/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(activeRunId)}`
      ).then((r) => r.json());
      if (cancelled || !runRes.data?.id) {
        setMessages(loaded);
        return;
      }

      const run = runRes.data as { id: string; prompt: string };
      const raw = sessionStorage.getItem(seqStorageKey(run.id));
      const parsed = raw === null ? -1 : Number.parseInt(raw, 10);
      const afterSeq = Number.isNaN(parsed) ? -1 : parsed;
      const next = buildRecoveryMessages(loaded, run);
      setMessages(next);
      lastEventSeqRef.current = afterSeq;
      void consumeRunStreamRef.current(run.id, afterSeq);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, taskId, projectId, initialPrompt]);

  useChatAutoSave({ conversationId, messages, status, model: 'glm-4.7' });

  const didSendInitialRef = useRef(false);
  useEffect(() => {
    if (!initialPrompt || status !== 'ready') return;
    if (didSendInitialRef.current || messages.length > 0) return;
    if (!taskId || !projectId) return;
    didSendInitialRef.current = true;
    void startRun(initialPrompt);
  }, [initialPrompt, status, messages.length, taskId, projectId, startRun]);

  const [input, setInput] = useState('');
  const [activeTab, setActiveTab] = useState<PreviewTab | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || isLoading) return;
    if (!taskId || !projectId) {
      setError(new Error('缺少 projectId 或 taskId'));
      setStatus('error');
      return;
    }
    setInput('');
    clearError();
    void startRun(text);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, isLoading, startRun, clearError, taskId, projectId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  const chatStatusForUi = status;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="size-7 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center text-[11px] font-bold text-blue-600 dark:text-blue-400">
            {agentName.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="text-[14px] font-semibold leading-none">{agentName}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{providerLabel}</div>
          </div>
          {isLoading && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950 text-[11px] font-medium text-blue-600 dark:text-blue-400 ml-2">
              <div className="size-1.5 rounded-full bg-blue-600 dark:bg-blue-400 animate-pulse" />
              Running
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center bg-muted rounded-lg p-[2px] mr-2">
            {(['preview', 'code', 'files'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab((prev) => (prev === tab ? null : tab))}
                className={cn(
                  'h-6 px-2.5 rounded-md text-[11px] font-medium cursor-pointer transition',
                  activeTab === tab
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="size-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent/50 transition cursor-pointer"
            title="Open in new tab"
          >
            <ExternalLink className="size-3.5" />
          </button>
          <button
            type="button"
            className="size-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent/50 transition cursor-pointer"
            title="Fullscreen"
          >
            <Maximize2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className={cn('flex flex-col min-w-[380px]', activeTab ? 'w-[42%]' : 'flex-1')}>
          <div className="flex-1 overflow-y-auto px-5 py-5">
            {(!taskId || !projectId) && (
              <div className="mx-auto max-w-2xl mb-4 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                缺少 task 或项目上下文。请从首页「开始聊天」进入，或从侧边栏打开会话。
              </div>
            )}

            {error && (
              <div className="mx-auto max-w-2xl mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {error.message || 'An error occurred. Please try again.'}
              </div>
            )}

            <Conversation className="max-w-2xl mx-auto">
              <ConversationContent>
                {messages.length === 0 && !isLoading && (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                    <p className="text-sm">Send a message to start building.</p>
                  </div>
                )}

                {messages.map((message, messageIndex) => (
                  <Message key={message.id} from={message.role}>
                    <MessageContent>
                      {message.parts.map((part, partIndex) => (
                        <PartRenderer
                          // biome-ignore lint/suspicious/noArrayIndexKey: stable message parts
                          key={`${message.id}-${partIndex}`}
                          part={part}
                          message={message}
                          index={partIndex}
                          status={chatStatusForUi}
                          isLastMessage={messageIndex === messages.length - 1}
                        />
                      ))}
                      {isLoading &&
                        messageIndex === messages.length - 1 &&
                        (message.role === 'user' ||
                          (message.role === 'assistant' &&
                            !message.parts.some((p) => p.type === 'text' && p.text))) && (
                          <div className="flex items-center gap-2 py-2 text-muted-foreground">
                            <LoadingDots size="md" label="Thinking" />
                          </div>
                        )}
                    </MessageContent>
                  </Message>
                ))}
              </ConversationContent>
            </Conversation>
          </div>

          <div className="border-t border-border px-4 py-3 shrink-0">
            <div className="max-w-2xl mx-auto">
              <div className="flex items-end gap-2.5 border border-border rounded-xl p-2.5 bg-card focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/10 transition-all">
                <button
                  type="button"
                  className="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent/50 transition cursor-pointer shrink-0"
                >
                  <Paperclip className="size-[18px]" />
                </button>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleInput}
                  onKeyDown={handleKeyDown}
                  placeholder="Continue the conversation..."
                  rows={1}
                  disabled={isLoading || !taskId || !projectId}
                  className="flex-1 bg-transparent border-none outline-none text-[13px] resize-none min-h-[24px] max-h-[200px] placeholder:text-muted-foreground/50 leading-relaxed disabled:opacity-50"
                />
                {isLoading ? (
                  <button
                    type="button"
                    onClick={() => void stopRun()}
                    className="size-8 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center hover:bg-destructive/20 transition cursor-pointer shrink-0"
                  >
                    <Square className="size-[18px]" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    className="size-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition cursor-pointer shrink-0"
                  >
                    <ArrowUp className="size-[18px]" />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between mt-1.5 px-1">
                <span className="text-[10px] text-muted-foreground">
                  <kbd className="font-mono text-[9px] bg-muted border border-border px-1 rounded">
                    Enter
                  </kbd>{' '}
                  send
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">{providerLabel}</span>
              </div>
            </div>
          </div>
        </div>

        {activeTab && (
          <>
            <div className="w-[3px] shrink-0 relative cursor-col-resize group flex items-center justify-center hover:bg-primary/10 transition-colors">
              <div className="w-1 h-8 rounded-full bg-border group-hover:bg-muted-foreground transition-colors" />
            </div>
            <div className="flex-1 flex flex-col min-w-0 bg-muted/30">
              {activeTab === 'preview' && (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
                    <button
                      type="button"
                      className="size-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/50 transition cursor-pointer"
                    >
                      <ChevronLeft className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="size-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/50 transition cursor-pointer"
                    >
                      <ChevronRight className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="size-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent/50 transition cursor-pointer"
                    >
                      <RefreshCw className="size-3.5" />
                    </button>
                    <div className="flex-1 flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5">
                      <Lock className="size-3 text-muted-foreground shrink-0" />
                      <span className="text-[12px] font-mono text-muted-foreground truncate">
                        https://sandbox-abc123.openrush.dev
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                    <div className="text-center">
                      <div className="size-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-3">
                        <ExternalLink className="size-6" />
                      </div>
                      <p className="font-medium">Preview</p>
                      <p className="text-[12px] text-muted-foreground mt-1">
                        The sandbox preview will appear here when a run is active.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {activeTab === 'code' && (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
                    <Code className="size-4 text-muted-foreground" />
                    <span className="text-[12px] font-mono text-muted-foreground">Code view</span>
                  </div>
                  <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                    Code changes will appear here during agent execution.
                  </div>
                </div>
              )}
              {activeTab === 'files' && (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
                    <FileText className="size-4 text-muted-foreground" />
                    <span className="text-[12px] font-medium text-foreground">Workspace Files</span>
                  </div>
                  <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                    Modified files will appear here during agent execution.
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
