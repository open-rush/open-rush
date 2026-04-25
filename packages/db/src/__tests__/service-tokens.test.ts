import { createHash, randomBytes } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser } from '../../test/factories.js';
import { closeTestDb, createTestDb, type TestDb, truncateAll } from '../../test/pglite-helpers.js';
import { serviceTokens, users } from '../schema/index.js';

let db: TestDb;
let pglite: PGlite;

beforeAll(async () => {
  const result = await createTestDb();
  db = result.db;
  pglite = result.pglite;
});

afterAll(async () => {
  await closeTestDb(pglite);
});

beforeEach(async () => {
  await truncateAll(db);
});

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function makeRawToken(): string {
  return `sk_${randomBytes(32).toString('base64url')}`;
}

/**
 * The "active token" predicate mirrors the one that authenticate()
 * middleware will use in task-5. Keeping the expression here as a
 * first-class test helper so schema changes that break the predicate
 * are caught immediately.
 */
function activeTokenWhere(tokenHash: string, now: Date) {
  return and(
    eq(serviceTokens.tokenHash, tokenHash),
    isNull(serviceTokens.revokedAt),
    or(isNull(serviceTokens.expiresAt), gt(serviceTokens.expiresAt, now))
  );
}

describe('service_tokens schema', () => {
  describe('column defaults & shape', () => {
    it('defaults scopes to empty array and nullable timestamps to null', async () => {
      const user = await createTestUser(db);
      const raw = makeRawToken();
      const [token] = await db
        .insert(serviceTokens)
        .values({
          tokenHash: hashToken(raw),
          name: 'cli-token',
          ownerUserId: user.id,
        })
        .returning();

      expect(token.scopes).toEqual([]);
      expect(token.lastUsedAt).toBeNull();
      expect(token.expiresAt).toBeNull();
      expect(token.revokedAt).toBeNull();
      expect(token.createdAt).toBeInstanceOf(Date);
      expect(token.id).toBeTruthy();
    });

    it('persists scopes as a jsonb array and preserves ordering', async () => {
      const user = await createTestUser(db);
      const scopes = ['agents:read', 'agents:write', 'runs:read', 'runs:write'];
      const [token] = await db
        .insert(serviceTokens)
        .values({
          tokenHash: hashToken(makeRawToken()),
          name: 't',
          ownerUserId: user.id,
          scopes,
        })
        .returning();

      expect(token.scopes).toEqual(scopes);
    });

    it('stores SHA-256 hash (64 hex chars), not the plaintext', async () => {
      const user = await createTestUser(db);
      const raw = makeRawToken();
      const hash = hashToken(raw);
      const [token] = await db
        .insert(serviceTokens)
        .values({ tokenHash: hash, name: 't', ownerUserId: user.id })
        .returning();

      expect(token.tokenHash).toBe(hash);
      expect(token.tokenHash).toHaveLength(64);
      expect(token.tokenHash).not.toContain('sk_');
      expect(token.tokenHash).not.toContain(raw);
    });
  });

  describe('unique + FK constraints', () => {
    it('rejects duplicate token_hash globally (across users)', async () => {
      const userA = await createTestUser(db, { email: 'a@example.com' });
      const userB = await createTestUser(db, { email: 'b@example.com' });
      const hash = hashToken(makeRawToken());

      await db.insert(serviceTokens).values({
        tokenHash: hash,
        name: 'token-a',
        ownerUserId: userA.id,
      });
      await expect(
        db.insert(serviceTokens).values({
          tokenHash: hash,
          name: 'token-b',
          ownerUserId: userB.id,
        })
      ).rejects.toThrow();
    });

    it('rejects insert with NULL owner_user_id (NOT NULL constraint)', async () => {
      // Use raw SQL to bypass TypeScript's NOT NULL enforcement on the
      // drizzle schema type and verify the DB-level constraint directly.
      await expect(
        db.execute(sql`
          INSERT INTO service_tokens (token_hash, name, owner_user_id)
          VALUES (${hashToken(makeRawToken())}, 't', NULL)
        `)
      ).rejects.toThrow();
    });

    it('rejects insert with non-existent owner_user_id (FK violation)', async () => {
      await expect(
        db.insert(serviceTokens).values({
          tokenHash: hashToken(makeRawToken()),
          name: 't',
          ownerUserId: '00000000-0000-0000-0000-000000000000',
        })
      ).rejects.toThrow();
    });

    it('cascades delete when owner user is deleted', async () => {
      const user = await createTestUser(db);
      await db.insert(serviceTokens).values([
        { tokenHash: hashToken(makeRawToken()), name: 't1', ownerUserId: user.id },
        { tokenHash: hashToken(makeRawToken()), name: 't2', ownerUserId: user.id },
      ]);
      const before = await db
        .select()
        .from(serviceTokens)
        .where(eq(serviceTokens.ownerUserId, user.id));
      expect(before).toHaveLength(2);

      await db.delete(users).where(eq(users.id, user.id));

      const after = await db
        .select()
        .from(serviceTokens)
        .where(eq(serviceTokens.ownerUserId, user.id));
      expect(after).toHaveLength(0);
    });
  });

  describe('active-token predicate (authenticate() middleware preview)', () => {
    it('finds the token when revoked_at IS NULL and expires_at IS NULL', async () => {
      const user = await createTestUser(db);
      const raw = makeRawToken();
      const hash = hashToken(raw);
      await db.insert(serviceTokens).values({ tokenHash: hash, name: 't', ownerUserId: user.id });

      const now = new Date();
      const [found] = await db.select().from(serviceTokens).where(activeTokenWhere(hash, now));
      expect(found?.tokenHash).toBe(hash);
    });

    it('finds the token when expires_at is in the future', async () => {
      const user = await createTestUser(db);
      const hash = hashToken(makeRawToken());
      const future = new Date(Date.now() + 60_000);
      await db.insert(serviceTokens).values({
        tokenHash: hash,
        name: 't',
        ownerUserId: user.id,
        expiresAt: future,
      });

      const [found] = await db
        .select()
        .from(serviceTokens)
        .where(activeTokenWhere(hash, new Date()));
      expect(found?.tokenHash).toBe(hash);
    });

    it('does not find the token when revoked_at is set (revocation)', async () => {
      const user = await createTestUser(db);
      const hash = hashToken(makeRawToken());
      await db.insert(serviceTokens).values({
        tokenHash: hash,
        name: 't',
        ownerUserId: user.id,
      });

      // Revoke
      await db
        .update(serviceTokens)
        .set({ revokedAt: new Date() })
        .where(eq(serviceTokens.tokenHash, hash));

      const rows = await db.select().from(serviceTokens).where(activeTokenWhere(hash, new Date()));
      expect(rows).toHaveLength(0);
    });

    it('does not find the token when expires_at is in the past', async () => {
      const user = await createTestUser(db);
      const hash = hashToken(makeRawToken());
      const past = new Date(Date.now() - 60_000);
      await db.insert(serviceTokens).values({
        tokenHash: hash,
        name: 't',
        ownerUserId: user.id,
        expiresAt: past,
      });

      const rows = await db.select().from(serviceTokens).where(activeTokenWhere(hash, new Date()));
      expect(rows).toHaveLength(0);
    });

    it('finds active row even when a revoked row with the same-looking metadata exists', async () => {
      // User rotates a token: one revoked, one active with different hash.
      const user = await createTestUser(db);
      const revokedHash = hashToken(makeRawToken());
      const activeHash = hashToken(makeRawToken());

      await db.insert(serviceTokens).values([
        {
          tokenHash: revokedHash,
          name: 'old',
          ownerUserId: user.id,
          revokedAt: new Date(),
        },
        {
          tokenHash: activeHash,
          name: 'new',
          ownerUserId: user.id,
        },
      ]);

      const [found] = await db
        .select()
        .from(serviceTokens)
        .where(activeTokenWhere(activeHash, new Date()));
      expect(found?.name).toBe('new');

      const revoked = await db
        .select()
        .from(serviceTokens)
        .where(activeTokenWhere(revokedHash, new Date()));
      expect(revoked).toHaveLength(0);
    });
  });

  describe('bookkeeping updates', () => {
    it('can update last_used_at without affecting other fields', async () => {
      const user = await createTestUser(db);
      const raw = makeRawToken();
      const hash = hashToken(raw);
      const [created] = await db
        .insert(serviceTokens)
        .values({
          tokenHash: hash,
          name: 't',
          ownerUserId: user.id,
          scopes: ['agents:read'],
        })
        .returning();

      const stamp = new Date('2026-06-01T00:00:00Z');
      await db
        .update(serviceTokens)
        .set({ lastUsedAt: stamp })
        .where(eq(serviceTokens.id, created.id));

      const [after] = await db.select().from(serviceTokens).where(eq(serviceTokens.id, created.id));
      expect(after.lastUsedAt).toEqual(stamp);
      expect(after.scopes).toEqual(['agents:read']);
      expect(after.revokedAt).toBeNull();
    });

    it('listing tokens by owner uses the owner index and returns only that user', async () => {
      const userA = await createTestUser(db, { email: 'owner-a@example.com' });
      const userB = await createTestUser(db, { email: 'owner-b@example.com' });
      await db.insert(serviceTokens).values([
        { tokenHash: hashToken(makeRawToken()), name: 'a1', ownerUserId: userA.id },
        { tokenHash: hashToken(makeRawToken()), name: 'a2', ownerUserId: userA.id },
        { tokenHash: hashToken(makeRawToken()), name: 'b1', ownerUserId: userB.id },
      ]);

      const ownedByA = await db
        .select()
        .from(serviceTokens)
        .where(eq(serviceTokens.ownerUserId, userA.id));
      expect(ownedByA.map((t) => t.name).sort()).toEqual(['a1', 'a2']);
    });
  });

  describe('active partial index', () => {
    it('partial index exists for WHERE revoked_at IS NULL', async () => {
      // pg_indexes meta query — confirms the partial predicate is what spec says.
      const rows = await db.execute(sql`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'service_tokens'
          AND indexname = 'service_tokens_active_idx'
      `);
      const rowList = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
      expect(rowList.length).toBeGreaterThan(0);
      const def = (rowList[0] as { indexdef: string }).indexdef;
      expect(def).toMatch(/token_hash/);
      expect(def).toMatch(/revoked_at IS NULL/i);
    });
  });
});
