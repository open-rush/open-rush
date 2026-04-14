import { z } from 'zod';

// --- Run Status (15-state machine) ---

export const RunStatus = z.enum([
  'queued',
  'provisioning',
  'preparing',
  'running',
  'finalizing_prepare',
  'finalizing_uploading',
  'finalizing_verifying',
  'finalizing_metadata_commit',
  'finalized',
  'completed',
  'failed',
  'worker_unreachable',
  'finalizing_retryable_failed',
  'finalizing_timeout',
  'finalizing_manual_intervention',
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const VALID_RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ['provisioning', 'failed'],
  provisioning: ['preparing', 'failed'],
  preparing: ['running', 'failed'],
  running: ['finalizing_prepare', 'failed', 'worker_unreachable'],
  finalizing_prepare: ['finalizing_uploading', 'failed', 'finalizing_retryable_failed'],
  finalizing_uploading: ['finalizing_verifying', 'failed', 'finalizing_retryable_failed'],
  finalizing_verifying: ['finalizing_metadata_commit', 'failed', 'finalizing_retryable_failed'],
  finalizing_metadata_commit: ['finalized', 'failed', 'finalizing_retryable_failed'],
  finalized: ['completed'],
  completed: [],
  failed: ['queued'],
  worker_unreachable: ['failed', 'running'],
  finalizing_retryable_failed: ['finalizing_uploading', 'finalizing_timeout'],
  finalizing_timeout: ['finalizing_manual_intervention'],
  finalizing_manual_intervention: ['failed'],
};

/** Terminal: no outgoing transitions possible */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['completed'];

/** Failed but can retry back to queued */
export const RETRYABLE_RUN_STATUSES: readonly RunStatus[] = ['failed'];

export function isValidRunTransition(from: RunStatus, to: RunStatus): boolean {
  return VALID_RUN_TRANSITIONS[from].includes(to);
}

// --- Agent ---

export const AgentStatus = z.enum(['active', 'inactive']);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const AgentDeliveryMode = z.enum(['chat', 'workspace']);
export type AgentDeliveryMode = z.infer<typeof AgentDeliveryMode>;

// --- Trigger & Provider ---

export const TriggerSource = z.enum(['user', 'webhook', 'api']);
export type TriggerSource = z.infer<typeof TriggerSource>;

export const ConnectionMode = z.enum(['anthropic', 'bedrock', 'custom']);
export type ConnectionMode = z.infer<typeof ConnectionMode>;

// --- Artifact ---

export const ArtifactKind = z.enum(['diff', 'patch', 'log', 'screenshot', 'build', 'report']);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

// --- Sandbox ---

export const SandboxStatus = z.enum([
  'creating',
  'running',
  'idle',
  'destroying',
  'destroyed',
  'error',
]);
export type SandboxStatus = z.infer<typeof SandboxStatus>;

// --- Vault ---

export const VaultScope = z.enum(['platform', 'project']);
export type VaultScope = z.infer<typeof VaultScope>;

export const CredentialType = z.enum([
  'env_var',
  'anthropic_api',
  'aws_bedrock',
  'custom_endpoint',
  'git_token',
  'npm_token',
  'http_bearer',
]);
export type CredentialType = z.infer<typeof CredentialType>;

// --- Checkpoint ---

export const CheckpointStatus = z.enum(['in_progress', 'completed', 'failed']);
export type CheckpointStatus = z.infer<typeof CheckpointStatus>;

// --- Project Member ---

export const ProjectMemberRole = z.enum(['owner', 'admin', 'member']);
export type ProjectMemberRole = z.infer<typeof ProjectMemberRole>;

// --- UIMessageChunk ---

export const UIMessageChunkType = z.enum([
  'text-start',
  'text-delta',
  'text-end',
  'reasoning-start',
  'reasoning-delta',
  'reasoning-end',
  'tool-input-start',
  'tool-input-delta',
  'tool-input-available',
  'tool-output-available',
  'tool-output-error',
  'start',
  'finish',
  'error',
  'start-step',
  'finish-step',
]);
export type UIMessageChunkType = z.infer<typeof UIMessageChunkType>;
