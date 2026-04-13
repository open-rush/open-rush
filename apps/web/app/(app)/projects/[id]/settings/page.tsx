'use client';

import { ArrowLeft, Trash2, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ProjectAgentManager } from '@/components/agents/project-agent-manager';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';

interface ProjectData {
  id: string;
  name: string;
  description: string | null;
}

interface MemberData {
  userId: string;
  projectId: string;
  role: string;
}

export default function ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<ProjectData | null>(null);
  const [members, setMembers] = useState<MemberData[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const fetchData = useCallback(async () => {
    const [projRes, membersRes] = await Promise.all([
      fetch(`/api/projects/${id}`),
      fetch(`/api/projects/${id}/members`),
    ]);
    if (projRes.ok) {
      const { data } = await projRes.json();
      setProject(data);
      setName(data.name);
      setDescription(data.description ?? '');
    }
    if (membersRes.ok) {
      const { data } = await membersRes.json();
      setMembers(data);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    await fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: description || undefined }),
    });
    await fetchData();
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this project?')) return;
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    if (res.ok) router.push('/dashboard');
  };

  if (!project) {
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="flex-1 overflow-auto p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/projects/${id}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">Project Settings</h1>
      </div>

      {/* General */}
      <Card className="p-4 mb-6">
        <h2 className="font-medium mb-4">General</h2>
        <div className="space-y-3">
          <div>
            <label htmlFor="project-name" className="text-sm text-muted-foreground">
              Name
            </label>
            <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="project-description" className="text-sm text-muted-foreground">
              Description
            </label>
            <Input
              id="project-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <Button size="sm" onClick={handleSave}>
            Save
          </Button>
        </div>
      </Card>

      {/* Members */}
      <Card className="p-4 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium">Members</h2>
          <Button variant="outline" size="sm">
            <UserPlus className="mr-2 h-4 w-4" />
            Invite
          </Button>
        </div>
        <div className="space-y-2">
          {members.map((m) => (
            <div key={m.userId} className="flex items-center justify-between py-1">
              <span className="text-sm">{m.userId}</span>
              <span className="text-xs text-muted-foreground capitalize">{m.role}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Agents */}
      <div id="agents" className="mb-6">
        <ProjectAgentManager projectId={id} />
      </div>

      <Separator className="my-6" />

      {/* Danger Zone */}
      <Card className="p-4 border-destructive">
        <h2 className="font-medium text-destructive mb-2">Danger Zone</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Deleting a project is reversible (soft delete). Contact admin for permanent deletion.
        </p>
        <Button variant="destructive" size="sm" onClick={handleDelete}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Project
        </Button>
      </Card>
    </div>
  );
}
