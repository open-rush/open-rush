'use client';

import type { Agent } from '@open-rush/contracts';
import { Bot, Loader2, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type AgentFormChangeHandler,
  type AgentFormState,
  EMPTY_AGENT_FORM,
  toAgentFormState,
  toAgentPayload,
} from '@/components/agents/agent-form';
import { AgentFormFields } from '@/components/agents/agent-form-fields';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { MultiSelectOption } from '@/components/ui/multi-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
}

interface AgentStudioClientProps {
  projects: ProjectSummary[];
}

function AgentEditorDialog({
  open,
  onOpenChange,
  projectName,
  form,
  mode,
  saving,
  skillOptions,
  mcpOptions,
  onChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectName?: string;
  form: AgentFormState;
  mode: 'create' | 'edit';
  saving: boolean;
  skillOptions: MultiSelectOption[];
  mcpOptions: MultiSelectOption[];
  onChange: AgentFormChangeHandler;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Create Agent' : 'Edit Agent'}</DialogTitle>
          <DialogDescription>
            {projectName ? `Configure an agent for ${projectName}.` : 'Configure a project agent.'}
          </DialogDescription>
        </DialogHeader>

        <AgentFormFields
          form={form}
          idPrefix="studio-agent"
          promptRows={10}
          skillOptions={skillOptions}
          mcpOptions={mcpOptions}
          onChange={onChange}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={saving || !form.name.trim()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {mode === 'create' ? 'Create Agent' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgentStudioClient({ projects }: AgentStudioClientProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    projects[0]?.id ?? null
  );
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [form, setForm] = useState<AgentFormState>(EMPTY_AGENT_FORM);
  const [skillOptions, setSkillOptions] = useState<MultiSelectOption[]>([]);
  const [mcpOptions, setMcpOptions] = useState<MultiSelectOption[]>([]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const load = useCallback(async () => {
    if (!selectedProjectId) {
      setAgents([]);
      setSkillOptions([]);
      setMcpOptions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [agentsRes, skillsRes, mcpRes] = await Promise.all([
        fetch(`/api/agents?projectId=${selectedProjectId}`),
        fetch(`/api/projects/${selectedProjectId}/skills`).catch(() => null),
        fetch(`/api/projects/${selectedProjectId}/mcp`).catch(() => null),
      ]);

      const agentsJson = await agentsRes.json();
      if (!agentsRes.ok) {
        throw new Error(agentsJson.error ?? 'Failed to load agents');
      }
      setAgents((agentsJson.data ?? []) as Agent[]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreateDialog = useCallback(() => {
    setEditingAgentId(null);
    setForm(EMPTY_AGENT_FORM);
    setDialogOpen(true);
  }, []);

  const openEditDialog = useCallback((agent: Agent) => {
    setEditingAgentId(agent.id);
    setForm(toAgentFormState(agent));
    setDialogOpen(true);
  }, []);

  const handleChange = useCallback(
    <K extends keyof AgentFormState>(key: K, value: AgentFormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const handleSave = useCallback(async () => {
    if (!selectedProjectId) return;

    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const isEdit = !!editingAgentId;
      const res = await fetch(isEdit ? `/api/agents/${editingAgentId}` : '/api/agents', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toAgentPayload(selectedProjectId, form)),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? 'Failed to save agent');
      }

      setDialogOpen(false);
      setMessage(isEdit ? 'Agent updated.' : 'Agent created.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent');
    } finally {
      setSaving(false);
    }
  }, [editingAgentId, form, load, selectedProjectId]);

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
        setMessage('Agent deleted.');
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete agent');
      } finally {
        setDeletingId(null);
      }
    },
    [load]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Agent Studio</h1>
          <p className="text-sm text-muted-foreground">
            Browse project agents, switch the default runtime, and create new agents in a modal.
          </p>
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Select
            value={selectedProjectId ?? undefined}
            onValueChange={(value) => setSelectedProjectId(value)}
          >
            <SelectTrigger className="min-w-60">
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={openCreateDialog} disabled={!selectedProjectId}>
            <Plus className="mr-2 h-4 w-4" />
            Create Agent
          </Button>
        </div>
      </div>

      {message ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading agents...
          </div>
        </Card>
      ) : agents.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Sparkles className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No agents for this project yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create one to get a project-specific runtime like Rush App.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => {
            return (
              <Card
                key={agent.id}
                className="overflow-hidden border-border/80 transition-all hover:-translate-y-0.5 hover:shadow-md"
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted">
                          <Bot className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="truncate">{agent.name}</CardTitle>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="line-clamp-3 min-h-[60px] text-sm text-muted-foreground">
                    {agent.description || 'No description provided.'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{agent.deliveryMode}</Badge>
                    <Badge variant="outline">{agent.maxSteps} steps</Badge>
                    {agent.skills.length > 0 ? (
                      <Badge variant="outline">{agent.skills.length} skills</Badge>
                    ) : null}
                    {agent.mcpServers.length > 0 ? (
                      <Badge variant="outline">{agent.mcpServers.length} MCPs</Badge>
                    ) : null}
                  </div>
                </CardContent>
                <CardFooter className="justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEditDialog(agent)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      Edit
                    </Button>
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
                  <div className="flex items-center gap-2">
                    {selectedProjectId ? (
                      <Link
                        href={`/chat/new?projectId=${selectedProjectId}&agent=${encodeURIComponent(agent.name)}&agentId=${agent.id}&agentWelcome=${encodeURIComponent(agent.description || `你好，我是 ${agent.name}。告诉我你想完成什么，我会直接开始。`)}`}
                      >
                        <Button size="sm">Use</Button>
                      </Link>
                    ) : null}
                  </div>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-end">
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <AgentEditorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectName={selectedProject?.name}
        form={form}
        mode={editingAgentId ? 'edit' : 'create'}
        saving={saving}
        skillOptions={skillOptions}
        mcpOptions={mcpOptions}
        onChange={handleChange}
        onSubmit={() => void handleSave()}
      />
    </div>
  );
}
