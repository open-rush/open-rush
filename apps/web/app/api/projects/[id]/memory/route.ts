import { DrizzleMemoryDb } from '@lux/control-plane';
import { getDbClient } from '@lux/db';
import type { CreateMemoryInput, MemorySearchOptions } from '@lux/memory';
import { MemoryStore } from '@lux/memory';

import { apiError, apiSuccess, requireAuth, verifyProjectAccess } from '@/lib/api-utils';

// Stub embedding provider — replace with real provider (e.g. Anthropic, OpenAI, Zhipu)
const stubEmbedding = {
  dimensions: 768,
  async embed(_text: string): Promise<number[]> {
    // Return zero vector; real implementation calls an embedding API
    return new Array(768).fill(0);
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
      limit: Number(url.searchParams.get('limit')) || 10,
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

  if (!body.agentId || !body.content) {
    return apiError(400, 'VALIDATION_ERROR', 'agentId and content are required');
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
  try {
    await store.remove(memoryId);
  } catch {
    return apiError(404, 'NOT_FOUND', 'Memory entry not found');
  }
  return apiSuccess({ deleted: true });
}
