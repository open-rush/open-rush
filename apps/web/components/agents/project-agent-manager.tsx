'use client';

import type { Agent, ProjectAgent } from '@open-rush/contracts';
import { Bot, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type AgentFormState,
  EMPTY_AGENT_FORM,
  toAgentFormState,
  toAgentPayload,
} from '@/components/agents/agent-form';
import { AgentFormFields } from '@/components/agents/agent-form-fields';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { MultiSelectOption } from '@/components/ui/multi-select';

interface ProjectAgentManagerProps {
  projectId: string;
}

export function ProjectAgentManager({ projectId }: ProjectAgentManagerProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [currentBinding, setCurrentBinding] = useState<ProjectAgent | null>(null);
  const [currentAgent, setCurrentAgent] = useState<Agent | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [form, setForm] = useState<AgentFormState>(EMPTY_AGENT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skillOptions, setSkillOptions] = useState<MultiSelectOption[]>([]);
  const [mcpOptions, setMcpOptions] = useState<MultiSelectOption[]>([]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [agentsRes, currentRes, skillsRes, mcpRes] = await Promise.all([
        fetch(`/api/agents?projectId=${projectId}`),
        fetch(`/api/projects/${projectId}/agent`),
        fetch(`/api/projects/${projectId}/skills`).catch(() => null),
        fetch(`/api/projects/${projectId}/mcp`).catch(() => null),
      ]);

      const agentsJson = await agentsRes.json();
      const currentJson = await currentRes.json();

      if (!agentsRes.ok) {
        throw new Error(agentsJson.error ?? 'Failed to load agents');
      }
      if (!currentRes.ok) {
        throw new Error(currentJson.error ?? 'Failed to load current agent');
      }

      const nextAgents = (agentsJson.data ?? []) as Agent[];
      const nextCurrentAgent = (currentJson.data?.currentAgent ?? null) as Agent | null;
      const nextBinding = (currentJson.data?.binding ?? null) as ProjectAgent | null;

      setAgents(nextAgents);
      setCurrentAgent(nextCurrentAgent);
      setCurrentBinding(nextBinding);

      if (skillsRes?.ok) {
        const skillsJson = await skillsRes.json();
        const skills = (skillsJson.data ?? []) as { name: string }[];
        setSkillOptions(skills.map((s) => ({ value: s.name, label: s.name })));
      }

      if (mcpRes?.ok) {
        const mcpJson = await mcpRes.json();
        const servers = (mcpJson.data ?? []) as { name: string }[];
        setMcpOptions(servers.map((s) => ({ value: s.name, label: s.name })));
      }

      setSelectedAgentId((prev) => {
        if (prev && nextAgents.some((agent) => agent.id === prev)) {
          return prev;
        }
        return nextCurrentAgent?.id ?? nextAgents[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedAgent) {
      setForm(toAgentFormState(selectedAgent));
      setMessage(null);
      setError(null);
      return;
    }

    setForm(EMPTY_AGENT_FORM);
  }, [selectedAgent]);

  const handleCreateNew = useCallback(() => {
    setSelectedAgentId(null);
    setForm(EMPTY_AGENT_FORM);
    setMessage(null);
    setError(null);
  }, []);

  const handleChange = useCallback(
    <K extends keyof AgentFormState>(key: K, value: AgentFormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const url = selectedAgentId ? `/api/agents/${selectedAgentId}` : '/api/agents';
      const method = selectedAgentId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toAgentPayload(projectId, form)),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? 'Failed to save agent');
      }

      const saved = json.data as Agent;
      setMessage(selectedAgentId ? 'Agent updated.' : 'Agent created.');
      await load();
      setSelectedAgentId(saved.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent');
    } finally {
      setSaving(false);
    }
  }, [form, load, projectId, selectedAgentId]);

  const handleSetCurrent = useCallback(
    async (agentId: string) => {
      setSwitchingId(agentId);
      setMessage(null);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/agent`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error ?? 'Failed to switch current agent');
        }
        setMessage('Current agent updated.');
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to switch current agent');
      } finally {
        setSwitchingId(null);
      }
    },
    [load, projectId]
  );

  const handleDelete = useCallback(
    async (agentId: string) => {
      if (!window.confirm('Delete this agent?')) return;

      setDeletingId(agentId);
      setMessage(null);
      setError(null);
      try {
        const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error ?? 'Failed to delete agent');
        }

        if (selectedAgentId === agentId) {
          setSelectedAgentId(null);
          setForm(EMPTY_AGENT_FORM);
        }

        setMessage('Agent deleted.');
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete agent');
      } finally {
        setDeletingId(null);
      }
    },
    [load, selectedAgentId]
  );

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading agents...
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Current Agent</CardTitle>
          <CardDescription>
            Runs for this project will use the current agent by default.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {currentAgent ? (
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{currentAgent.name}</span>
                  <Badge
                    variant={currentAgent.deliveryMode === 'workspace' ? 'default' : 'outline'}
                  >
                    {currentAgent.deliveryMode}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {currentAgent.description || 'No description provided.'}
                </p>
              </div>
              {currentBinding?.configOverride ? (
                <Badge variant="outline">Project override active</Badge>
              ) : null}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No current agent yet. Create one below to get started.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Agents</CardTitle>
            <CardDescription>Create and manage agents available in this project.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{agents.length} configured</p>
              <Button size="sm" variant="outline" onClick={handleCreateNew}>
                <Plus className="mr-2 h-4 w-4" />
                New Agent
              </Button>
            </div>

            {agents.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No agents yet. Create your first project agent.
              </div>
            ) : (
              <div className="space-y-3">
                {agents.map((agent) => {
                  const isCurrent = currentAgent?.id === agent.id;
                  const isSelected = selectedAgentId === agent.id;
                  return (
                    <div
                      key={agent.id}
                      className={`rounded-lg border p-3 transition-colors ${
                        isSelected ? 'border-primary bg-primary/5' : 'border-border'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => setSelectedAgentId(agent.id)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{agent.name}</span>
                            {isCurrent ? <Badge>Current</Badge> : null}
                          </div>
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {agent.description || 'No description provided.'}
                          </p>
                        </button>
                        <div className="flex items-center gap-2">
                          {!isCurrent ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleSetCurrent(agent.id)}
                              disabled={switchingId === agent.id}
                            >
                              {switchingId === agent.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                'Set Current'
                              )}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => void handleDelete(agent.id)}
                            disabled={deletingId === agent.id}
                          >
                            {deletingId === agent.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>{selectedAgent ? 'Edit Agent' : 'Create Agent'}</CardTitle>
            <CardDescription>
              Configure the default runtime behavior for this project agent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AgentFormFields
              form={form}
              idPrefix="agent"
              skillOptions={skillOptions}
              mcpOptions={mcpOptions}
              onChange={handleChange}
            />

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {message ? <p className="text-sm text-emerald-600">{message}</p> : null}
          </CardContent>
          <CardFooter className="justify-between">
            <Button size="sm" variant="outline" onClick={() => void load()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving || !form.name.trim()}
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {selectedAgent ? 'Save Changes' : 'Create Agent'}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
