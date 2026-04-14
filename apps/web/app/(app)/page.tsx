'use client';

import { ArrowUp, Bot, ChevronRight, Loader2, Paperclip, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AgentOption {
  id: string;
  name: string;
  description: string | null;
  deliveryMode: 'chat' | 'workspace';
  projectId: string;
  projectName: string;
}

function getAgentWelcome(agent: AgentOption): string {
  if (agent.description?.trim()) {
    return `你好，我是 ${agent.name}。${agent.description.trim()}`;
  }
  return `你好，我是 ${agent.name}。告诉我你想完成什么，我会直接开始。`;
}

export default function HomePage() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );
  const featuredAgents = useMemo(() => agents.slice(0, 6), [agents]);
  const overflowAgents = useMemo(() => agents.slice(6), [agents]);

  useEffect(() => {
    let mounted = true;

    async function loadAgents() {
      setLoadingAgents(true);
      setError(null);
      try {
        const projectsRes = await fetch('/api/projects');
        const projectsJson = await projectsRes.json();
        if (!projectsRes.ok) {
          throw new Error(projectsJson.error ?? 'Failed to load projects');
        }

        const projectList = (projectsJson.data ?? []) as Array<{ id: string; name: string }>;
        const agentResponses = await Promise.all(
          projectList.map(async (project) => {
            const response = await fetch(`/api/agents?projectId=${project.id}`);
            const json = await response.json();
            if (!response.ok) {
              throw new Error(json.error ?? `Failed to load agents for ${project.name}`);
            }

            return ((json.data ?? []) as AgentOption[]).map((agent) => ({
              ...agent,
              projectId: project.id,
              projectName: project.name,
            }));
          })
        );

        const nextAgents = agentResponses.flat();
        if (!mounted) return;
        setAgents(nextAgents);
        setSelectedAgentId(nextAgents[0]?.id ?? null);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load agents');
      } finally {
        if (mounted) setLoadingAgents(false);
      }
    }

    void loadAgents();
    return () => {
      mounted = false;
    };
  }, []);

  const startChat = useCallback(
    async (prompt: string, agentOverride?: AgentOption | null) => {
      const agent = agentOverride ?? selectedAgent;
      if (isStarting) return;
      if (!prompt.trim() && !agentOverride) return;

      setIsStarting(true);
      setError(null);

      try {
        const res = await fetch('/api/chat/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(agent ? { agentId: agent.id } : {}),
        });
        const json = await res.json();

        if (json.success && json.data) {
          const { projectId, conversationId } = json.data;
          const params = new URLSearchParams({ projectId });
          if (agent) {
            params.set('agent', agent.name);
            params.set('agentId', agent.id);
            params.set('agentWelcome', getAgentWelcome(agent));
          }
          if (prompt.trim()) {
            params.set('prompt', prompt);
          }
          router.push(`/chat/${conversationId}?${params.toString()}`);
          return;
        }

        throw new Error(json.error ?? 'Failed to start chat');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start chat');
        setIsStarting(false);
      }
    },
    [isStarting, router, selectedAgent]
  );

  const handleSubmit = useCallback(() => {
    void startChat(input.trim());
  }, [input, startChat]);

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

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 pt-[12vh] pb-10">
          <div className="text-center mb-8">
            <div className="size-12 rounded-2xl bg-gradient-to-br from-blue-50 to-violet-50 dark:from-blue-950 dark:to-violet-950 border border-blue-100 dark:border-blue-900 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="size-6 text-blue-600 dark:text-blue-400" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight mb-1">What do you want to build?</h1>
            <p className="text-[14px] text-muted-foreground">
              Start with an agent below, or type a task and send it to the selected one.
            </p>
          </div>

          {error ? (
            <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <div className="mb-8">
            <div className="flex items-end gap-3 border border-border rounded-2xl p-4 bg-card shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/10 focus-within:shadow-md transition-all">
              <button
                type="button"
                className="size-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent/50 transition cursor-pointer shrink-0"
              >
                <Paperclip className="size-5" />
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder={
                  selectedAgent
                    ? `Send the first message to ${selectedAgent.name}...`
                    : 'Type your task to start chatting...'
                }
                rows={1}
                disabled={isStarting}
                className="flex-1 bg-transparent border-none outline-none text-[15px] resize-none min-h-[28px] max-h-[200px] placeholder:text-muted-foreground/50 leading-relaxed disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isStarting}
                className="size-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition cursor-pointer shrink-0 disabled:opacity-50"
              >
                {isStarting ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <ArrowUp className="size-5" />
                )}
              </button>
            </div>
            <div className="flex items-center justify-between mt-2 px-2">
              <span className="text-[11px] text-muted-foreground">
                <kbd className="font-mono text-[10px] bg-muted border border-border px-1 rounded">
                  Enter
                </kbd>{' '}
                to send
              </span>
              <span className="text-[11px] text-muted-foreground">
                {selectedAgent
                  ? `${selectedAgent.name} is ready`
                  : 'System default agent will be used'}
              </span>
            </div>
          </div>

          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Bot className="size-3.5" />
              Agents
            </div>
            {overflowAgents.length > 0 ? (
              <Select
                value={selectedAgentId ?? undefined}
                onValueChange={(value) => setSelectedAgentId(value)}
              >
                <SelectTrigger className="h-7 min-w-40 text-[11px]">
                  <SelectValue placeholder="More agents" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {loadingAgents ? (
              <div className="col-span-2 flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading agents...
              </div>
            ) : null}

            {featuredAgents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => {
                  setSelectedAgentId(agent.id);
                  void startChat('', agent);
                }}
                disabled={isStarting}
                className="flex items-start gap-2.5 p-3.5 rounded-xl border border-border text-left hover:bg-accent/30 hover:border-border transition cursor-pointer group disabled:opacity-50"
              >
                <Bot className="size-4 text-muted-foreground mt-0.5 shrink-0 group-hover:text-primary transition" />
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-[12px] font-medium text-foreground">{agent.name}</div>
                    <Badge variant="outline">{agent.deliveryMode}</Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 line-clamp-3">
                    {getAgentWelcome(agent)}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <Badge variant="secondary">{agent.projectName}</Badge>
                    <span className="inline-flex items-center gap-1 text-[11px] text-primary">
                      Start with {agent.name}
                      <ChevronRight className="size-3" />
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
