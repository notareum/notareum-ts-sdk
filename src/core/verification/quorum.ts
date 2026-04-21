/**
 * Quorum calculation logic matching NotareumVerificationEngine exactly.
 *
 * Resolution logic:
 *   1. Wait until total attestations >= quorumSize.
 *   2. Compute (approvals * BPS_DENOM) / total >= threshold.
 *   3. If true: VERIFIED. Else: UNVERIFIED.
 */

import { BPS_DENOM } from "../constants.js";
import { QuorumError } from "../errors.js";
import { VerificationLevel } from "../nota/types.js";
import { QUORUM_CONFIGS } from "./types.js";
import type { QuorumConfig } from "./types.js";

export type { QuorumConfig };

/**
 * Returns the quorum configuration for a given verification level.
 */
export function getQuorumConfig(level: VerificationLevel): QuorumConfig {
  const config = QUORUM_CONFIGS[level];
  if (!config) {
    throw new QuorumError(`Unknown verification level: ${level}`);
  }
  return config;
}

/**
 * Determines whether a quorum has been reached.
 *
 * @param level - Verification level.
 * @param approvals - Number of approval attestations.
 * @param rejections - Number of rejection attestations.
 * @returns true if total attestations >= quorumSize.
 */
export function isQuorumReached(
  level: VerificationLevel,
  approvals: number,
  rejections: number
): boolean {
  const { quorumSize } = getQuorumConfig(level);
  return approvals + rejections >= quorumSize;
}

/**
 * Determines the outcome once quorum is reached.
 * Matches the contract logic: (approvals * BPS_DENOM) / total >= threshold.
 *
 * @param level - Verification level.
 * @param approvals - Number of approval attestations.
 * @param rejections - Number of rejection attestations.
 * @returns true = VERIFIED, false = UNVERIFIED (rejected).
 * @throws QuorumError if quorum has not been reached yet.
 */
export function resolveQuorum(
  level: VerificationLevel,
  approvals: number,
  rejections: number
): boolean {
  const { quorumSize, thresholdBps } = getQuorumConfig(level);
  const total = approvals + rejections;
  if (total < quorumSize) {
    throw new QuorumError(
      `Quorum not reached: need ${quorumSize} attestations, got ${total}.`
    );
  }
  // Match contract: (approvals * BPS_DENOM) / total >= threshold
  const approvalsN = BigInt(approvals);
  const totalN = BigInt(total);
  return (approvalsN * BPS_DENOM) / totalN >= thresholdBps;
}

/**
 * Returns the minimum number of approvals needed to pass at a given quorum size.
 * Useful for UI and off-chain tooling.
 *
 * @param level - Verification level.
 * @returns Minimum approval count required.
 */
export function minApprovalsToPass(level: VerificationLevel): number {
  const { quorumSize, thresholdBps } = getQuorumConfig(level);
  // Find minimum approvals such that (approvals * BPS_DENOM) / quorumSize >= threshold
  for (let approvals = 0; approvals <= quorumSize; approvals++) {
    const approvalsN = BigInt(approvals);
    const totalN = BigInt(quorumSize);
    if ((approvalsN * BPS_DENOM) / totalN >= thresholdBps) {
      return approvals;
    }
  }
  return quorumSize;
}
