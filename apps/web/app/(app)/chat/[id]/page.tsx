'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { PartRenderer } from '@/components/ai-elements/part-renderer';
import { LoadingDots } from '@/components/ui/loading-dots';
import { useChatAutoSave } from '@/hooks/use-chat-auto-save';
import { useStreamHeartbeat } from '@/hooks/use-stream-heartbeat';
import { useStreamRecovery } from '@/hooks/use-stream-recovery';
import { useStreamStop } from '@/hooks/use-stream-stop';
import { cn } from '@/lib/utils';

type PreviewTab = 'preview' | 'code' | 'files';

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();

  const projectId = searchParams.get('projectId') ?? undefined;
  const conversationId = params.id;
  const agentName = searchParams.get('agent') || 'Builder';
  const initialPrompt = searchParams.get('prompt')?.trim() ?? '';

  // Agent metadata (provider label = backend connection mode)
  const [providerLabel, setProviderLabel] = useState('Claude Code');
  useEffect(() => {
    let cancelled = false;
    const backendLabels: Record<string, string> = {
      bedrock: 'Bedrock',
      anthropic: 'Anthropic API',
      custom: 'Custom Endpoint',
    };

    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((healthJson) => {
        if (cancelled) return;
        const backend = backendLabels[healthJson?.provider] ?? '';
        setProviderLabel(backend ? `Claude Code · ${backend}` : 'Claude Code');
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Transport & useChat
  // ---------------------------------------------------------------------------
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: { projectId, conversationId },
      }),
    [projectId, conversationId]
  );

  const { messages, setMessages, sendMessage, status, stop, error, clearError, resumeStream } =
    useChat({
      id: `chat-${conversationId}`,
      transport,
    });

  const isLoading = status === 'submitted' || status === 'streaming';

  // ---------------------------------------------------------------------------
  // Stream reliability
  // ---------------------------------------------------------------------------
  const { isDisconnect, resetDisconnect } = useStreamRecovery();
  const streamStop = useStreamStop(status);

  const resumeStreamWithReset = useCallback(() => {
    resetDisconnect();
    resumeStream?.();
  }, [resetDisconnect, resumeStream]);

  useStreamHeartbeat(projectId, status, isDisconnect, resumeStreamWithReset, {
    enabled: messages.length > 0,
    interval: 1500,
    maxRetries: 5,
  });

  // ---------------------------------------------------------------------------
  // Load history messages
  // ---------------------------------------------------------------------------
  const loadedConvRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId || conversationId === loadedConvRef.current) return;
    loadedConvRef.current = conversationId;

    fetch(`/api/chat/${conversationId}/messages`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          setMessages(res.data as UIMessage[]);
        }
      })
      .catch(() => {});
  }, [conversationId, setMessages]);

  // ---------------------------------------------------------------------------
  // Auto-save
  // ---------------------------------------------------------------------------
  useChatAutoSave({ conversationId, messages, status, model: 'glm-4.7' });

  // ---------------------------------------------------------------------------
  // Send initial prompt from Home page
  // ---------------------------------------------------------------------------
  const didSendInitialRef = useRef(false);
  useEffect(() => {
    if (!initialPrompt || status !== 'ready') return;
    if (didSendInitialRef.current || messages.length > 0) return;
    didSendInitialRef.current = true;
    sendMessage({ text: initialPrompt });
  }, [initialPrompt, sendMessage, status, messages.length]);

  // ---------------------------------------------------------------------------
  // Local state
  // ---------------------------------------------------------------------------
  const [input, setInput] = useState('');
  const [activeTab, setActiveTab] = useState<PreviewTab | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    clearError();
    sendMessage({ text });
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, isLoading, sendMessage, clearError]);

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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
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

      {/* Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Chat Panel */}
        <div className={cn('flex flex-col min-w-[380px]', activeTab ? 'w-[42%]' : 'flex-1')}>
          <div className="flex-1 overflow-y-auto px-5 py-5">
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
                          status={status}
                          isLastMessage={messageIndex === messages.length - 1}
                        />
                      ))}
                      {isLoading &&
                        messageIndex === messages.length - 1 &&
                        message.role === 'user' && (
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

          {/* Input */}
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
                  disabled={isLoading}
                  className="flex-1 bg-transparent border-none outline-none text-[13px] resize-none min-h-[24px] max-h-[200px] placeholder:text-muted-foreground/50 leading-relaxed disabled:opacity-50"
                />
                {isLoading ? (
                  <button
                    type="button"
                    onClick={() => streamStop(projectId, messages.length, stop)}
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

        {/* Preview Panel (collapsed by default) */}
        {activeTab && (
          <>
            <div
              className="w-[3px] shrink-0 relative cursor-col-resize group flex items-center justify-center hover:bg-primary/10 transition-colors"
              title="Drag to resize"
            >
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
