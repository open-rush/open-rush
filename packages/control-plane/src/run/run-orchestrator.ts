import type { CreateSandboxOptions, SandboxProvider } from '@open-rush/sandbox';
import type { EventStore } from '../event-store.js';
import { AgentBridge } from './agent-bridge.js';
import type { AgentExecutor } from './agent-executor.js';
import type { CheckpointService } from './checkpoint-service.js';
import type { RunService } from './run-service.js';
import {
  createErrorHandler,
  createIncrementalSave,
  createStreamLogger,
  StreamPipeline,
} from './stream-middleware.js';

export interface RunOrchestratorDeps {
  runService: RunService;
  sandboxProvider: SandboxProvider;
  eventStore: EventStore;
  checkpointService?: CheckpointService;
  agentExecutor?: AgentExecutor;
  resolveProjectIdForAgent?: (agentId: string) => Promise<string | null>;
}

export class RunOrchestrator {
  constructor(private deps: RunOrchestratorDeps) {}

  /**
   * Execute a run. Supports both initial runs and follow-up runs (with parentRunId).
   * Follow-up runs attempt to restore from the parent's checkpoint.
   * If the parent sandbox is gone, degrades to a fresh initial run.
   */
  async execute(runId: string, prompt: string, agentId: string): Promise<void> {
    const run = await this.deps.runService.getById(runId);
    const isFollowUp = run?.parentRunId != null;
    let sandboxId: string | null = null;
    let agentContext: Awaited<ReturnType<AgentExecutor['prepareContext']>> | null = null;

    try {
      // 1. queued → provisioning
      await this.deps.runService.transition(runId, 'provisioning');

      if (this.deps.agentExecutor && this.deps.resolveProjectIdForAgent) {
        const projectId = await this.deps.resolveProjectIdForAgent(agentId);
        if (!projectId) {
          throw new Error(`Project not found for agent ${agentId}`);
        }
        agentContext = await this.deps.agentExecutor.prepareContext(agentId, projectId);
      }

      const sandboxOptions: CreateSandboxOptions = {
        agentId,
        env: agentContext?.env,
        ttlSeconds: 3600,
      };
      const sandbox = await this.deps.sandboxProvider.create(sandboxOptions);
      sandboxId = sandbox.id;

      // 2. provisioning → preparing
      await this.deps.runService.transition(runId, 'preparing');
      await this.deps.sandboxProvider.healthCheck(sandboxId);

      // 3. Restore checkpoint for follow-up runs
      let restoredContext: string | null = null;
      if (isFollowUp && this.deps.checkpointService && run?.parentRunId) {
        restoredContext = await this.tryRestoreCheckpoint(run.parentRunId);
      }

      // 4. preparing → running
      const endpointUrl = await this.deps.sandboxProvider.getEndpointUrl(sandboxId, 8787);
      if (!endpointUrl) {
        throw new Error('Sandbox endpoint URL not available');
      }

      const agentBridge = new AgentBridge({ agentWorkerUrl: endpointUrl });
      await this.deps.runService.transition(runId, 'running');

      // Build prompt with restored context if available
      const fullPrompt = restoredContext
        ? `[Restored from checkpoint]\n\nPrevious context:\n${restoredContext}\n\nNew prompt:\n${prompt}`
        : prompt;

      const { response } = await agentBridge.sendPrompt(fullPrompt, {
        sessionId: runId,
        env: agentContext?.env,
        systemPrompt: agentContext?.systemPrompt,
        allowedTools: agentContext?.agentConfig.allowedTools,
        maxTurns: agentContext?.agentConfig.maxSteps,
      });

      // 5. Consume SSE stream
      await this.consumeStream(runId, response);

      // 6. Finalization
      await this.finalize(runId);
    } catch (error) {
      try {
        await this.deps.runService.transition(runId, 'failed', {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Best-effort
      }
    } finally {
      if (sandboxId) {
        this.deps.sandboxProvider.destroy(sandboxId).catch(() => {});
      }
    }
  }

  /**
   * Try to restore checkpoint from parent run.
   * Returns restored messages context as string, or null if unavailable.
   */
  private async tryRestoreCheckpoint(parentRunId: string): Promise<string | null> {
    if (!this.deps.checkpointService) return null;

    try {
      const result = await this.deps.checkpointService.restoreCheckpoint(parentRunId);
      if (!result) {
        console.log(
          `[recovery] No checkpoint found for parent run ${parentRunId}, running as initial`
        );
        return null;
      }

      const events = JSON.parse(result.messages.toString());
      // Extract text content from events for context
      const textParts: string[] = [];
      for (const event of events) {
        if (event.eventType === 'text-delta' || event.eventType === 'text_delta') {
          const content = event.payload?.content ?? event.payload?.delta ?? '';
          if (content) textParts.push(content);
        }
      }

      console.log(
        `[recovery] Restored checkpoint for parent ${parentRunId}: ${events.length} events, lastSeq=${result.checkpoint.lastEventSeq}`
      );
      return textParts.join('');
    } catch (err) {
      console.warn(
        `[recovery] Checkpoint restore failed for parent ${parentRunId}, degrading to initial:`,
        err
      );
      return null;
    }
  }

  private async finalize(runId: string): Promise<void> {
    await this.deps.runService.transition(runId, 'finalizing_prepare');

    // Create checkpoint for potential follow-up runs
    if (this.deps.checkpointService) {
      try {
        const events = await this.deps.eventStore.getEvents(runId);
        const lastSeq = await this.deps.eventStore.getLastSeq(runId);
        const snapshot = Buffer.from(JSON.stringify(events));
        await this.deps.checkpointService.createCheckpoint(runId, snapshot, lastSeq);
      } catch (err) {
        console.error('[finalize] Checkpoint creation failed (non-fatal):', err);
      }
    }

    await this.deps.runService.transition(runId, 'finalizing_uploading');
    await this.deps.runService.transition(runId, 'finalizing_verifying');
    await this.deps.runService.transition(runId, 'finalizing_metadata_commit');
    await this.deps.runService.transition(runId, 'finalized');
    await this.deps.runService.transition(runId, 'completed');
  }

  private async consumeStream(runId: string, response: Response): Promise<void> {
    const pipeline = new StreamPipeline();

    pipeline.use(
      createIncrementalSave(async (event) => {
        await this.deps.eventStore.append({
          runId,
          eventType: event.type,
          payload: event.data,
          seq: event.seq,
        });
      }, 1)
    );

    pipeline.use(
      createErrorHandler((err, event) => {
        console.error('Stream error:', err, event);
      })
    );

    pipeline.use(
      createStreamLogger((msg, data) => {
        console.log(msg, data);
      })
    );

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let seq = 0;
    let buffer = '';

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6);
        if (json === '[DONE]') continue;

        try {
          const data = JSON.parse(json);
          const event = { type: data.type, data, seq: seq++, timestamp: Date.now() };
          await pipeline.process(event);
        } catch {
          /* skip malformed */
        }
      }
    }
  }
}
