/**
 * Registry types matching NotareumNotaRegistry constants.
 *
 * Contract source: NotareumNotaRegistry.sol
 *   uint8 constants: TYPE_ADDRESS=0, TYPE_TRANSACTION=1, ..., TYPE_METADATA=5
 *   Governance can add new types via addResourceType().
 *   enum VerificationStatus { UNVERIFIED, PENDING, VERIFIED, DISPUTED, REVOKED }
 *
 * These are re-exported from nota/types to avoid duplication.
 */

import type { VerificationStatus } from "../nota/types.js";

export {
  ResourceType,
  VerificationStatus,
} from "../nota/types.js";

export type { ResourceTypeId } from "../nota/types.js";

/**
 * On-chain resource record as returned by NotareumNotaRegistry.getResource.
 */
export interface ResourceInfo {
  /** bytes32 resource ID. */
  resourceId: string;
  /** On-chain owner address. */
  owner: string;
  /** Resource type ID (uint8). */
  resourceType: number;
  /** EIP-155 chain ID. */
  chainId: bigint;
  /** Resource identifier string. */
  identifier: string;
  /** Optional human-readable alias. */
  alias: string;
  /** Current verification status. */
  verificationStatus: VerificationStatus;
  /** Unix timestamp (seconds) when registered. */
  registeredAt: bigint;
  /** bytes32 proof hash, or zero bytes if not set. */
  proofHash: string;
}
