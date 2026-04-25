/**
 * /api/v1/vaults/entries — Vault credential CRUD contracts.
 *
 * Endpoints (3):
 * - POST   /api/v1/vaults/entries
 * - GET    /api/v1/vaults/entries
 * - DELETE /api/v1/vaults/entries/:id
 *
 * Critical rule: GET never returns `encryptedValue`. That's only stored
 * server-side; the runtime injection path (task-10/11) reads it from DB.
 */
import { z } from 'zod';
import { CredentialType, VaultScope } from '../enums.js';
import { paginatedResponseSchema, paginationQuerySchema, successResponseSchema } from './common.js';

// ---------------------------------------------------------------------------
// POST /api/v1/vaults/entries
// ---------------------------------------------------------------------------

/**
 * Create a vault entry. The caller supplies the PLAINTEXT value; the
 * service encrypts before storing. `encryptedValue` is never present on
 * the wire from the client side.
 *
 * - `scope === 'platform'` requires `projectId` to be null/absent.
 * - `scope === 'project'` requires `projectId`.
 * - Enforced by the DB CHECK constraint on vault_entries (see 0000
 *   migration) — so a mismatched pair hits 400/VALIDATION_ERROR here,
 *   but also 500/INTERNAL if bypassed. The API refine below catches early.
 */
export const createVaultEntryRequestSchema = z
  .object({
    scope: VaultScope,
    projectId: z.string().uuid().optional(),
    name: z.string().min(1).max(255),
    credentialType: CredentialType,
    /** Plaintext secret — server encrypts before storing. */
    value: z.string().min(1),
    /** Env-var name to inject at sandbox start (optional). */
    injectionTarget: z.string().max(255).optional(),
  })
  .refine(
    (v) => (v.scope === 'platform' && !v.projectId) || (v.scope === 'project' && !!v.projectId),
    {
      message: 'scope="platform" requires no projectId; scope="project" requires projectId',
    }
  );
export type CreateVaultEntryRequest = z.infer<typeof createVaultEntryRequestSchema>;

/**
 * Vault entry as returned to the client.
 *
 * **Never includes `encryptedValue`.** The full DB column is deliberately
 * dropped from the wire format — including in service layer responses.
 */
export const vaultEntrySchema = z.object({
  id: z.string().uuid(),
  scope: VaultScope,
  projectId: z.string().uuid().nullable(),
  ownerId: z.string().uuid().nullable(),
  name: z.string(),
  credentialType: CredentialType,
  keyVersion: z.number().int().min(1),
  injectionTarget: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type VaultEntry = z.infer<typeof vaultEntrySchema>;

export const createVaultEntryResponseSchema = successResponseSchema(vaultEntrySchema);
export type CreateVaultEntryResponse = z.infer<typeof createVaultEntryResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/v1/vaults/entries
// ---------------------------------------------------------------------------

export const listVaultEntriesQuerySchema = paginationQuerySchema.extend({
  scope: VaultScope.optional(),
  projectId: z.string().uuid().optional(),
});
export type ListVaultEntriesQuery = z.infer<typeof listVaultEntriesQuerySchema>;

export const listVaultEntriesResponseSchema = paginatedResponseSchema(vaultEntrySchema);
export type ListVaultEntriesResponse = z.infer<typeof listVaultEntriesResponseSchema>;

// ---------------------------------------------------------------------------
// DELETE /api/v1/vaults/entries/:id
// ---------------------------------------------------------------------------

export const deleteVaultEntryParamsSchema = z.object({
  id: z.string().uuid(),
});
export type DeleteVaultEntryParams = z.infer<typeof deleteVaultEntryParamsSchema>;

export const deleteVaultEntryResponseSchema = successResponseSchema(
  z.object({ id: z.string().uuid() })
);
export type DeleteVaultEntryResponse = z.infer<typeof deleteVaultEntryResponseSchema>;
