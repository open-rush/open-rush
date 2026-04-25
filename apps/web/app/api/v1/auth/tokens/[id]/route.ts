/**
 * DELETE /api/v1/auth/tokens/:id — soft-revoke a Service Token.
 *
 * Source of truth: `specs/service-token-auth.md` §吊销.
 *
 * Behaviour:
 * - Requires an authenticated caller (session or service-token — a service
 *   token may revoke other tokens owned by the same user, consistent with
 *   GET semantics).
 * - Ownership is validated in the service layer: missing → 404, non-owner
 *   → 403. Enumerating a stranger's token id reveals existence-vs-absence,
 *   but not ownership, name, or scopes — consistent with how the rest of
 *   `/api/v1/*` treats resource existence.
 * - Idempotent: revoking an already-revoked row returns 200 with the
 *   original `revokedAt` (see spec §吊销 — "已发出的 token 立即失效" is a
 *   DB-level state, not a per-request action).
 */
import { v1 } from '@open-rush/contracts';
import { getDbClient } from '@open-rush/db';
import { revokeToken } from '@/lib/auth/service-token-service';
import { authenticate } from '@/lib/auth/unified-auth';

const { ERROR_CODE_HTTP_STATUS, deleteTokenParamsSchema } = v1;

function jsonError(
  code: v1.ErrorCode,
  message: string,
  extra: { hint?: string; issues?: Array<{ path: Array<string | number>; message: string }> } = {}
): Response {
  const body: v1.ErrorResponse = { error: { code, message, ...extra } };
  return Response.json(body, { status: ERROR_CODE_HTTP_STATUS[code] });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req);
  if (!auth) return jsonError('UNAUTHORIZED', 'authentication required');

  const { id: rawId } = await params;
  const parsed = deleteTokenParamsSchema.safeParse({ id: rawId });
  if (!parsed.success) {
    return jsonError('VALIDATION_ERROR', 'invalid token id', {
      issues: parsed.error.issues.map((i) => ({
        path: [...i.path] as Array<string | number>,
        message: i.message,
      })),
    });
  }

  const db = getDbClient();
  const result = await revokeToken(db, parsed.data.id, auth.userId);

  switch (result.kind) {
    case 'not_found':
      return jsonError('NOT_FOUND', 'token not found');
    case 'forbidden':
      return jsonError('FORBIDDEN', 'you do not own this token');
    case 'revoked': {
      const body: v1.DeleteTokenResponse = {
        data: { id: result.id, revokedAt: result.revokedAt.toISOString() },
      };
      return Response.json(body, { status: 200 });
    }
  }
}
