/**
 * /api/v1/agents/:agentId/runs/:runId/events
 *   - GET — Server-Sent Events stream of run events.
 *
 * Protocol (spec §事件协议 + §断线重连, locked in task-4 contracts):
 *   - Content-Type: text/event-stream
 *   - Cache-Control: no-cache, no-transform
 *   - Connection: keep-alive (Next.js adds this on Response bodies that
 *     are ReadableStreams, but we set it explicitly for upstream proxies)
 *   - X-Accel-Buffering: no (disable nginx buffering)
 *
 * Each frame:
 *   id: <seq>\n
 *   data: <json-payload>\n
 *   \n
 *
 * **Every frame carries `id: <seq>`** — the monotonic per-run
 * `run_events.seq` assigned by the single writer (control-worker via
 * `DrizzleEventStore.appendAssignSeq`). When the browser's EventSource
 * disconnects it automatically resends the last received `id` as a
 * `Last-Event-ID` header — we honour that to replay from
 * `seq > Last-Event-ID`. We never emit a bare `data:` frame (no
 * synthetic error / heartbeat events that would break the "always has
 * id" invariant). On fatal errors we simply close the stream — the
 * client's reconnect path resumes from its last seen id.
 *
 * We deliberately do NOT support a query-string cursor: the spec pins
 * the protocol to a single reconnection path (header-only) to avoid
 * two sources of truth.
 *
 * Liveness: for runs still in-flight we poll `run_events` at a fixed
 * interval for new rows. Rationale over subscribing to Redis pub/sub
 * via StreamRegistry: the `run_events` table is already the
 * authoritative single-writer destination (control-worker writes, all
 * readers read), and the existing legacy `/api/runs/[id]/stream` route
 * uses the same polling strategy. This keeps the v1 endpoint
 * transport-free (no Redis dependency for SSE②) and matches the
 * terminal-detection semantics used elsewhere. The polling loop stays
 * open until the run transitions to a terminal status; we drain once
 * more post-terminal to catch events written in the same tick as the
 * status flip, then close the stream.
 *
 * Auth + ownership (mirrors task-13):
 *   - session OR service-token with scope `runs:read`
 *   - Run must exist AND `run.taskId === URL agentId` (cross-agent
 *     probing returns 404 without revealing the real owner)
 *   - Owning project must be accessible via `verifyProjectAccess`
 *
 * Runtime: Next.js defaults to Edge for some stream routes, but we need
 * Node.js for the `pg`-backed Drizzle client — declared via
 * `export const runtime = 'nodejs'`.
 */

import { v1 } from '@open-rush/contracts';
import { DrizzleEventStore, DrizzleRunDb, isTerminal, RunService } from '@open-rush/control-plane';
import { getDbClient, tasks } from '@open-rush/db';
import { eq } from 'drizzle-orm';
import { v1Error, v1ValidationError } from '@/lib/api/v1-responses';
import { verifyProjectAccess } from '@/lib/api-utils';
import { authenticate, hasScope } from '@/lib/auth/unified-auth';

// Force Node.js runtime: pg + DrizzleEventStore are not Edge-safe.
export const runtime = 'nodejs';

/** Poll interval for live run_events delivery. */
const POLL_INTERVAL_MS = 500;

// -----------------------------------------------------------------------------
// GET /api/v1/agents/:agentId/runs/:runId/events
// -----------------------------------------------------------------------------

export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string; runId: string }> }
) {
  const auth = await authenticate(request);
  if (!auth) return v1Error('UNAUTHORIZED', 'Authentication required');
  if (!hasScope(auth, 'runs:read')) {
    return v1Error('FORBIDDEN', 'Missing scope runs:read');
  }

  const awaitedParams = await params;
  const paramsParsed = v1.getRunParamsSchema.safeParse({
    id: awaitedParams.agentId,
    runId: awaitedParams.runId,
  });
  if (!paramsParsed.success) return v1ValidationError(paramsParsed.error);

  // Last-Event-ID — header-only per spec §断线重连. Malformed values
  // (non-numeric, negative, empty/whitespace) → 400 rather than
  // silently clobbering to 0. This keeps clients from accidentally
  // re-replaying a whole stream when a buggy proxy strips digits from
  // the header. A missing header means "start from the beginning"
  // (`afterSeq = 0` → `seq > 0`, which includes seq=1 onwards since
  // `appendAssignSeq` numbers from 1).
  //
  // Note: `lastEventIdHeaderSchema` uses `z.coerce.number()` which
  // happily turns '' / '   ' into 0. We reject those at the route
  // layer so an empty header can't masquerade as "replay all" — the
  // client should either omit the header or send a concrete integer.
  const rawLastEventId =
    request.headers.get('last-event-id') ?? request.headers.get('Last-Event-ID');
  let afterSeq = 0;
  if (rawLastEventId !== null) {
    if (rawLastEventId.trim() === '') {
      return v1Error('VALIDATION_ERROR', 'Last-Event-ID must not be empty', {
        hint: 'omit the header to start from the beginning, or send a non-negative integer',
      });
    }
    const parsed = v1.lastEventIdHeaderSchema.safeParse(rawLastEventId);
    if (!parsed.success) return v1ValidationError(parsed.error);
    afterSeq = parsed.data;
  }

  const db = getDbClient();
  const runService = new RunService(new DrizzleRunDb(db));
  const run = await runService.getById(paramsParsed.data.runId);
  if (!run) return v1Error('NOT_FOUND', `Run ${paramsParsed.data.runId} not found`);

  // Cross-agent probing guard: a valid runId under a foreign agentId
  // returns 404 without leaking the true owner (mirrors task-13).
  if (run.taskId !== paramsParsed.data.id) {
    return v1Error('NOT_FOUND', `Run ${paramsParsed.data.runId} not found`);
  }

  const [task] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, paramsParsed.data.id))
    .limit(1);
  if (!task) return v1Error('NOT_FOUND', `Agent ${paramsParsed.data.id} not found`);
  if (!(await verifyProjectAccess(task.projectId, auth.userId))) {
    return v1Error('FORBIDDEN', 'No access to this project');
  }

  const eventStore = new DrizzleEventStore(db);
  const runId = paramsParsed.data.runId;
  const initialIsTerminal = isTerminal(run.status);

  // Shared lifecycle state. Declared in enclosing scope so both the
  // stream's `start` and `cancel` hooks (and the request.signal abort
  // listener wired below) can converge on the same `cleanup()`.
  let closed = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    try {
      streamController?.close();
    } catch {
      // already closed
    }
  };

  // Register the abort listener BEFORE we spin up any DB calls so a
  // client that disconnects during `drain()` still triggers cleanup.
  // `{ once: true }` means this listener fires at most once even if
  // the signal re-dispatches. If the signal has already aborted (e.g.
  // the caller cancelled before the handler ran), we short-circuit
  // via `closed = true` so `start()` skips all work.
  if (request.signal.aborted) {
    closed = true;
  } else {
    request.signal.addEventListener(
      'abort',
      () => {
        cleanup();
      },
      { once: true }
    );
  }

  // Web ReadableStream (required by Next.js Response). We emit strings;
  // Next.js wraps with the correct body encoding.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      streamController = controller;
      // If the client aborted before we even got here, close
      // immediately without touching the DB.
      if (closed) {
        try {
          controller.close();
        } catch {
          // already closed
        }
        return;
      }

      const encoder = new TextEncoder();
      let currentSeq = afterSeq;

      const emit = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // stream already closed (e.g. client aborted between the
          // `closed` check and enqueue). Swallow — cleanup handles it.
        }
      };

      /**
       * Load events strictly after `currentSeq` and emit each as an
       * SSE frame. Updates `currentSeq` to the last emitted `seq` so
       * the next drain continues monotonically.
       *
       * `DrizzleEventStore.getEvents(runId, afterSeq)` filters
       * `seq > afterSeq` and orders by seq ASC. Using it here keeps
       * the route decoupled from raw schema details.
       */
      const drain = async (): Promise<void> => {
        const events = await eventStore.getEvents(runId, currentSeq);
        for (const ev of events) {
          // Preserve spec frame shape: `id: <seq>\ndata: <json>\n\n`.
          // Every frame MUST have an `id` — spec §事件协议 + §断线重连.
          // Payload is emitted verbatim (control-worker already stored
          // the canonical UIMessageChunk JSON via appendAssignSeq).
          const payload = JSON.stringify(ev.payload);
          emit(`id: ${ev.seq}\ndata: ${payload}\n\n`);
          currentSeq = ev.seq;
        }
      };

      // Initial replay (always runs, even for terminal runs — the spec
      // requires "结束 run 全量 replay 后关闭").
      //
      // On failure we close without a body frame: emitting a synthetic
      // `data:` event would violate the "every frame has id" invariant
      // (we have no seq to attach). The client sees EOF and can
      // reconnect with its last-known `Last-Event-ID`; if the underlying
      // failure persists the reconnect will also EOF, which is the
      // correct failure mode for a transport that's cursor-based.
      try {
        await drain();
      } catch {
        cleanup();
        return;
      }

      if (initialIsTerminal) {
        // Terminal run — replay once, then close. No polling loop.
        // Matches spec §断线重连:
        // "对已结束 run(status=success/failed/cancelled),全量 replay
        //  后关连接".
        cleanup();
        return;
      }

      // Live stream: poll run_events on interval. Stay open until the
      // run transitions to terminal (then drain once more + close).
      // No fixed lifetime cap — the connection lives exactly as long as
      // the run does. The run's state machine + the caller's own
      // abort signal are the two termination sources.
      let polling = false;
      const tick = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          await drain();
          const latest = await runService.getById(runId);
          if (latest && isTerminal(latest.status)) {
            // Drain once more to catch any events written in the
            // window between `drain()` above and the status
            // transition. Safe because drain skips events with
            // `seq <= currentSeq`.
            await drain();
            cleanup();
          }
        } catch {
          // Transient polling errors: close without a synthetic frame
          // (see initial-replay comment above). The client will
          // reconnect on EOF.
          cleanup();
        } finally {
          polling = false;
        }
      };

      // Guard: the abort signal may have fired during `await drain()`.
      // If so, `cleanup()` already closed the stream — skip installing
      // the polling interval.
      if (closed) return;

      pollTimer = setInterval(() => {
        void tick();
      }, POLL_INTERVAL_MS);
    },

    cancel() {
      // Reader cancelled (e.g. route caller discarded the stream).
      // Invoke `cleanup()` so any in-flight polling interval is
      // cleared — otherwise we'd keep hitting the DB for an orphaned
      // consumer.
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable nginx buffering so frames reach the client immediately.
      'X-Accel-Buffering': 'no',
    },
  });
}
