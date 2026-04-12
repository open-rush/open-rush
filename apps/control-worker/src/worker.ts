import { PgBoss } from 'pg-boss';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://rush:rush@localhost:5432/rush';

async function main() {
  const boss = new PgBoss(DATABASE_URL);

  boss.on('error', (error: Error) => {
    console.error('pg-boss error:', error);
  });

  await boss.start();
  console.log('Control worker started');

  await boss.work<{ runId: string; prompt: string; agentId: string }>(
    'run:execute',
    async ([job]) => {
      if (!job) return;
      const { runId, agentId } = job.data;
      console.log(`Processing run:execute — runId=${runId}, agentId=${agentId}`);

      // TODO: Drive RunStateMachine transitions
      // queued → provisioning → preparing → running → finalization → completed
    }
  );

  await boss.work<{ runId: string }>('run:finalize', async ([job]) => {
    if (!job) return;
    const { runId } = job.data;
    console.log(`Processing run:finalize — runId=${runId}`);

    // TODO: Workspace snapshot, checkpoint, artifact upload
  });

  // Recovery: check for stuck runs every 2 minutes
  await boss.schedule('run:recover', '*/2 * * * *');
  await boss.work('run:recover', async () => {
    console.log('Checking for stuck runs...');
    // TODO: RunService.recoverStuckRuns()
  });

  process.on('SIGTERM', async () => {
    console.log('Shutting down control worker...');
    await boss.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('Shutting down control worker...');
    await boss.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Control worker failed to start:', error);
  process.exit(1);
});
