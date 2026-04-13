import { Layers } from 'lucide-react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AgentStudioClient } from '@/components/agents/agent-studio-client';

async function getProjects(userId: string) {
  const { DrizzleProjectDb, ProjectService } = await import('@rush/control-plane');
  const { getDbClient } = await import('@rush/db');
  const db = getDbClient();
  const service = new ProjectService(new DrizzleProjectDb(db));
  return service.listByUser(userId);
}

export default async function AgentStudioPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const projects = await getProjects(session.user.id);

  return (
    <div className="flex-1 overflow-auto p-6">
      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Layers className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-2">No projects yet</h2>
          <p className="text-sm text-muted-foreground">
            Create a project first, then configure its agents in Studio.
          </p>
        </div>
      ) : (
        <AgentStudioClient
          projects={projects.map((project) => ({
            id: project.id,
            name: project.name,
            description: project.description,
          }))}
        />
      )}
    </div>
  );
}
