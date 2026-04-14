import { Bot, FolderPlus, Settings } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

async function getProjects(userId: string) {
  const { DrizzleAgentConfigStore, DrizzleProjectDb, ProjectAgentService, ProjectService } =
    await import('@open-rush/control-plane');
  const { getDbClient } = await import('@open-rush/db');
  const db = getDbClient();
  const projectService = new ProjectService(new DrizzleProjectDb(db));
  const projectAgentService = new ProjectAgentService(db);
  const agentStore = new DrizzleAgentConfigStore(db);
  const projects = await projectService.listByUser(userId);

  return Promise.all(
    projects.map(async (project) => {
      const binding = await projectAgentService.getCurrentAgent(project.id);
      const currentAgent = binding ? await agentStore.getById(binding.agentId) : null;
      return {
        ...project,
        currentAgent,
      };
    })
  );
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const projects = await getProjects(session.user.id);

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        <Link href="/projects/new">
          <Button size="sm">
            <FolderPlus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <FolderPlus className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">No projects yet</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Create a project to start building with AI.
          </p>
          <Link href="/projects/new">
            <Button>Create your first project</Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="h-full hover:bg-accent transition-colors cursor-pointer">
                <CardHeader>
                  <CardTitle className="truncate">{project.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {project.description ? (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {project.description}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">No description provided yet.</p>
                  )}

                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Bot className="h-4 w-4 text-muted-foreground" />
                      Current agent
                    </div>
                    {project.currentAgent ? (
                      <div className="mt-2 flex items-center gap-2">
                        <Badge variant="secondary">{project.currentAgent.name}</Badge>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">
                        No current agent selected. Open project settings to configure one.
                      </p>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="justify-between">
                  <span className="text-xs text-muted-foreground">
                    {project.createdAt.toLocaleDateString()}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Settings className="h-3.5 w-3.5" />
                    Settings
                  </span>
                </CardFooter>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
