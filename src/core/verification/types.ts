/**
 * Verification types matching NotareumVerificationEngine constants exactly.
 *
 * Contract source: NotareumVerificationEngine.sol
 *   QUORUM_BASIC = 3, QUORUM_ENHANCED = 7, QUORUM_INSTITUTIONAL = 15
 *   THRESHOLD_BASIC = 6700, THRESHOLD_ENHANCED = 7500, THRESHOLD_INSTITUTIONAL = 7500
 *
 * VerificationLevel is re-exported from nota/types to avoid duplication.
 */

export { VerificationLevel } from "../nota/types.js";
import { VerificationLevel } from "../nota/types.js";

/**
 * Attestation result. Matches the boolean used in the contract
 * (true = approve, false = reject).
 */
export enum AttestationResult {
  REJECT = 0,
  APPROVE = 1,
}

/**
 * Quorum configuration for a verification level.
 */
export interface QuorumConfig {
  /** Number of attestations required before resolution. */
  quorumSize: number;
  /** Approval threshold in basis points (e.g., 6700 = 67%). */
  thresholdBps: bigint;
}

/** Quorum configs by level. */
export const QUORUM_CONFIGS: Record<VerificationLevel, QuorumConfig> = {
  [VerificationLevel.BASIC]: { quorumSize: 3, thresholdBps: 6700n },
  [VerificationLevel.ENHANCED]: { quorumSize: 7, thresholdBps: 7500n },
  [VerificationLevel.INSTITUTIONAL]: { quorumSize: 15, thresholdBps: 7500n },
};
