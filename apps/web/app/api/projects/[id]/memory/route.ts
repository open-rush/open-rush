import { DrizzleMemoryDb } from '@lux/control-plane';
import { getDbClient } from '@lux/db';
import type { CreateMemoryInput, MemorySearchOptions } from '@lux/memory';
import { MemoryStore } from '@lux/memory';

import { apiError, apiSuccess, requireAuth, verifyProjectAccess } from '@/lib/api-utils';

// Stub embedding provider — replace with real provider (e.g. Anthropic, OpenAI, Zhipu)
const stubEmbedding = {
  dimensions: 768,
  async embed(_text: string): Promise<number[]> {
    // TODO: replace with real embedding API (Anthropic, OpenAI, Zhipu)
    // Return empty array to skip vector storage until a real provider is configured
    return [];
  },
};

function getMemoryStore() {
  const db = getDbClient();
  return new MemoryStore(new DrizzleMemoryDb(db), stubEmbedding);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id: projectId } = await params;
  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) return apiError(403, 'FORBIDDEN', 'No access to this project');

  const url = new URL(request.url);
  const agentId = url.searchParams.get('agentId');
  const query = url.searchParams.get('q');

  if (!agentId) return apiError(400, 'VALIDATION_ERROR', 'agentId query param is required');

  const store = getMemoryStore();

  if (query) {
    const options: MemorySearchOptions = {
      agentId,
      projectId,
      query,
      limit: Math.min(Math.max(Number(url.searchParams.get('limit')) || 10, 1), 100),
    };
    const results = await store.search(options);
    return apiSuccess(results);
  }

  const entries = await store.listByAgent(agentId, projectId, 50);
  return apiSuccess(entries);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id: projectId } = await params;
  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) return apiError(403, 'FORBIDDEN', 'No access to this project');

  let body: Partial<CreateMemoryInput>;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  if (typeof body.agentId !== 'string' || typeof body.content !== 'string') {
    return apiError(400, 'VALIDATION_ERROR', 'agentId and content must be strings');
  }
  if (
    body.importance !== undefined &&
    (typeof body.importance !== 'number' || body.importance < 0 || body.importance > 1)
  ) {
    return apiError(400, 'VALIDATION_ERROR', 'importance must be a number between 0 and 1');
  }

  const store = getMemoryStore();
  const entry = await store.add({
    agentId: body.agentId,
    projectId,
    content: body.content,
    category: body.category,
    importance: body.importance,
    metadata: body.metadata,
  });

  return apiSuccess(entry, 201);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id: projectId } = await params;
  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) return apiError(403, 'FORBIDDEN', 'No access to this project');

  const url = new URL(request.url);
  const memoryId = url.searchParams.get('memoryId');
  if (!memoryId) return apiError(400, 'VALIDATION_ERROR', 'memoryId query param is required');

  const store = getMemoryStore();
  const entry = await store.getById(memoryId);
  if (!entry || entry.projectId !== projectId) {
    return apiError(404, 'NOT_FOUND', 'Memory entry not found');
  }
  await store.remove(memoryId);
  return apiSuccess({ deleted: true });
}
