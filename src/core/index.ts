/**
 * @notareum/core - Public API
 *
 * Re-exports all modules.
 */

// Constants and errors
export * from "./constants.js";
export * from "./errors.js";

// .nota file format (includes ResourceType constants, VerificationStatus, VerificationLevel)
export * from "./nota/index.js";

// Crypto utilities
export * from "./crypto/index.js";

// Registry (ResourceType constants and VerificationStatus re-exported from nota/types)
export type { ResourceInfo } from "./registry/types.js";
export { computeResourceId } from "./registry/resource-id.js";

// Verification (VerificationLevel re-exported from nota/types)
export { AttestationResult, QUORUM_CONFIGS } from "./verification/types.js";
export type { QuorumConfig } from "./verification/types.js";
export {
  getQuorumConfig,
  isQuorumReached,
  resolveQuorum,
  minApprovalsToPass,
} from "./verification/quorum.js";

// Staking
export * from "./staking/index.js";
