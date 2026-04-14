import { ArrowLeft, Bot, Settings } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

async function getProject(id: string, userId: string) {
  const {
    DbMembershipStore,
    DrizzleAgentConfigStore,
    DrizzleMembershipDb,
    DrizzleProjectDb,
    ProjectAgentService,
    ProjectService,
  } = await import('@open-rush/control-plane');
  const { getDbClient } = await import('@open-rush/db');
  const db = getDbClient();
  const service = new ProjectService(new DrizzleProjectDb(db));
  const project = await service.getById(id);
  if (!project) return null;

  const store = new DbMembershipStore(new DrizzleMembershipDb(db));
  const membership = await store.getMembership(userId, id);
  if (!membership) return null;

  const projectAgentService = new ProjectAgentService(db);
  const agentStore = new DrizzleAgentConfigStore(db);
  const binding = await projectAgentService.getCurrentAgent(id);
  const currentAgent = binding ? await agentStore.getById(binding.agentId) : null;

  return { project, currentAgent };
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const { id } = await params;
  const result = await getProject(id, session.user.id);
  if (!result) notFound();
  const { project, currentAgent } = result;

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{project.name}</h1>
          {project.description && (
            <p className="text-sm text-muted-foreground">{project.description}</p>
          )}
        </div>
        <Link href={`/projects/${id}/settings`}>
          <Button variant="outline" size="sm">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </Link>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Task Entry</CardTitle>
            <CardDescription>
              This project is ready to run tasks. The default runtime will use the current agent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Bot className="h-4 w-4 text-muted-foreground" />
                Current agent
              </div>
              {currentAgent ? (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{currentAgent.name}</Badge>
                    <Badge
                      variant={currentAgent.deliveryMode === 'workspace' ? 'default' : 'outline'}
                    >
                      {currentAgent.deliveryMode}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {currentAgent.description || 'No description provided for this agent yet.'}
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  No current agent selected. Go to project settings and choose one before starting
                  tasks.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <Link href={`/projects/${id}/settings#agents`}>
                <Button size="sm">Manage Agents</Button>
              </Link>
              <Link href={`/chat/new?projectId=${id}`}>
                <Button size="sm" variant="outline" disabled={!currentAgent}>
                  Start Task
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What Happens Next</CardTitle>
            <CardDescription>
              Runs created in this project now resolve through the project agent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>1. Pick or create a project agent in settings.</p>
            <p>2. Mark that agent as current for the project.</p>
            <p>3. New runs default to that current agent, even if the caller omits `agentId`.</p>
            <p>4. Runtime execution now receives the agent model, prompt, env, and tool policy.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
