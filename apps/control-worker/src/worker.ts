import {
  AgentExecutor,
  DrizzleAgentConfigStore,
  DrizzleRunDb,
  InMemoryEventStore,
  RunOrchestrator,
  RunService,
} from '@rush/control-plane';
import { closeDbClient, getDbClient } from '@rush/db';
import { OpenSandboxProvider } from '@rush/sandbox';
import { PgBoss } from 'pg-boss';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://rush:rush@localhost:5432/rush';
const OPENSANDBOX_API_URL = process.env.OPENSANDBOX_API_URL ?? 'http://localhost:8090';
const EXEC_HOST = process.env.OPENSANDBOX_EXEC_HOST ?? 'localhost';

async function main() {
  const boss = new PgBoss(DATABASE_URL);

  const db = getDbClient(DATABASE_URL);
  const runDb = new DrizzleRunDb(db);
  const runService = new RunService(runDb);
  const agentStore = new DrizzleAgentConfigStore(db);
  const agentExecutor = new AgentExecutor({
    resolveAgent: async (agentId, projectId) => {
      const agent = await agentStore.getById(agentId);
      if (!agent || agent.projectId !== projectId || agent.status !== 'active') {
        return null;
      }
      return agent;
    },
    resolveVaultEnv: async () => ({}),
    resolveSkills: async () => [],
    resolveMcpServers: async () => [],
  });
  const sandboxProvider = new OpenSandboxProvider({
    apiUrl: OPENSANDBOX_API_URL,
    execHost: EXEC_HOST,
  });
  const eventStore = new InMemoryEventStore();
  const orchestrator = new RunOrchestrator({
    runService,
    sandboxProvider,
    eventStore,
    agentExecutor,
    resolveProjectIdForAgent: async (agentId: string) => {
      const agent = await agentStore.getById(agentId);
      return agent?.projectId ?? null;
    },
  });

  boss.on('error', (error: Error) => {
    console.error('pg-boss error:', error);
  });

  await boss.start();

  // pg-boss 12.x requires explicit queue creation
  await boss.createQueue('run/execute');
  await boss.createQueue('run/finalize');
  await boss.createQueue('run/recover');

  console.log('Control worker started');

  await boss.work<{ runId: string; prompt: string; agentId: string }>(
    'run/execute',
    async ([job]) => {
      if (!job) return;
      const { runId, agentId } = job.data;
      if (!runId || !agentId) {
        console.error('run/execute job missing runId or agentId', job.data);
        return;
      }

      // Prefer job data prompt, fallback to DB
      let { prompt } = job.data;
      if (!prompt) {
        const run = await runService.getById(runId);
        if (!run) {
          console.error(`run/execute — run ${runId} not found in DB`);
          return;
        }
        prompt = run.prompt;
      }

      console.log(`Processing run/execute — runId=${runId}, agentId=${agentId}`);
      await orchestrator.execute(runId, prompt, agentId);
      console.log(`Completed run/execute — runId=${runId}`);
    }
  );

  await boss.work<{ runId: string }>('run/finalize', async ([job]) => {
    if (!job) return;
    const { runId } = job.data;
    console.log(`Processing run/finalize — runId=${runId} (handled by orchestrator)`);
    // Finalization is done inline by RunOrchestrator for MVP
  });

  // Recovery: check for stuck runs every 2 minutes
  await boss.schedule('run/recover', '*/2 * * * *');
  await boss.work('run/recover', async () => {
    console.log('Checking for stuck runs...');
    const recovered = await runService.recoverStuckRuns();
    if (recovered.length > 0) {
      console.log(`Recovered ${recovered.length} stuck runs`);
    }
  });

  async function shutdown() {
    console.log('Shutting down control worker...');
    await boss.stop();
    await closeDbClient();
    process.exit(0);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error('Control worker failed to start:', error);
  process.exit(1);
});
