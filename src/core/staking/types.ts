/**
 * Staking types matching NotareumValidatorStaking enums and constants exactly.
 *
 * Contract source: NotareumValidatorStaking.sol
 *   enum Tier { NONE, BASIC, PROFESSIONAL, ENTERPRISE, INSTITUTIONAL }
 *   BASIC_MIN = 10_000 * 10^18
 *   PROFESSIONAL_MIN = 50_000 * 10^18
 *   ENTERPRISE_MIN = 250_000 * 10^18
 *   INSTITUTIONAL_MIN = 1_000_000 * 10^18
 *   BASIC_DAILY_LIMIT = 100
 *   PROFESSIONAL_DAILY_LIMIT = 500
 *   ENTERPRISE_DAILY_LIMIT = 2500
 *   INSTITUTIONAL_DAILY_LIMIT = type(uint256).max (unlimited)
 *   UNBONDING_PERIOD_SECONDS = 14 days
 */

import {
  BASIC_MIN,
  PROFESSIONAL_MIN,
  ENTERPRISE_MIN,
  INSTITUTIONAL_MIN,
  BASIC_DAILY_LIMIT,
  PROFESSIONAL_DAILY_LIMIT,
  ENTERPRISE_DAILY_LIMIT,
  UNBONDING_PERIOD_SECONDS,
  BASIC_SLASH_BPS,
  PROFESSIONAL_SLASH_BPS,
  ENTERPRISE_SLASH_BPS,
  INSTITUTIONAL_SLASH_BPS,
  BASIC_REWARD_MUL,
  PROFESSIONAL_REWARD_MUL,
  ENTERPRISE_REWARD_MUL,
  INSTITUTIONAL_REWARD_MUL,
} from "../constants.js";

/**
 * Staking tier enum. Matches NotareumValidatorStaking.Tier.
 * NONE = 0 means below minimum stake (not an active validator).
 */
export enum StakingTier {
  NONE = 0,
  BASIC = 1,
  PROFESSIONAL = 2,
  ENTERPRISE = 3,
  INSTITUTIONAL = 4,
}

/** Minimum stake amounts in NOTA (18 decimals) by tier. */
export const TIER_MINIMUMS: Record<StakingTier, bigint | null> = {
  [StakingTier.NONE]: null,
  [StakingTier.BASIC]: BASIC_MIN,
  [StakingTier.PROFESSIONAL]: PROFESSIONAL_MIN,
  [StakingTier.ENTERPRISE]: ENTERPRISE_MIN,
  [StakingTier.INSTITUTIONAL]: INSTITUTIONAL_MIN,
};

/**
 * Daily verification limits by tier.
 * null means unlimited (type(uint256).max in the contract).
 */
export const TIER_DAILY_LIMITS: Record<StakingTier, number | null> = {
  [StakingTier.NONE]: 0,
  [StakingTier.BASIC]: BASIC_DAILY_LIMIT,
  [StakingTier.PROFESSIONAL]: PROFESSIONAL_DAILY_LIMIT,
  [StakingTier.ENTERPRISE]: ENTERPRISE_DAILY_LIMIT,
  [StakingTier.INSTITUTIONAL]: null, // unlimited
};

/** Slash rates in basis points by tier. */
export const TIER_SLASH_BPS: Record<StakingTier, bigint> = {
  [StakingTier.NONE]: 0n,
  [StakingTier.BASIC]: BASIC_SLASH_BPS,
  [StakingTier.PROFESSIONAL]: PROFESSIONAL_SLASH_BPS,
  [StakingTier.ENTERPRISE]: ENTERPRISE_SLASH_BPS,
  [StakingTier.INSTITUTIONAL]: INSTITUTIONAL_SLASH_BPS,
};

/** Reward multipliers (scaled x1000) by tier. */
export const TIER_REWARD_MULTIPLIERS: Record<StakingTier, bigint> = {
  [StakingTier.NONE]: 0n,
  [StakingTier.BASIC]: BASIC_REWARD_MUL,
  [StakingTier.PROFESSIONAL]: PROFESSIONAL_REWARD_MUL,
  [StakingTier.ENTERPRISE]: ENTERPRISE_REWARD_MUL,
  [StakingTier.INSTITUTIONAL]: INSTITUTIONAL_REWARD_MUL,
};

/** Unbonding period in seconds (14 days). */
export const UNBONDING_PERIOD = UNBONDING_PERIOD_SECONDS;

/**
 * Computes the staking tier for a given staked amount.
 * Matches the contract's _computeTier logic exactly.
 *
 * @param stakedAmount - Total staked NOTA in wei (18 decimals).
 * @returns The corresponding StakingTier.
 */
export function computeStakingTier(stakedAmount: bigint): StakingTier {
  if (stakedAmount >= INSTITUTIONAL_MIN) return StakingTier.INSTITUTIONAL;
  if (stakedAmount >= ENTERPRISE_MIN) return StakingTier.ENTERPRISE;
  if (stakedAmount >= PROFESSIONAL_MIN) return StakingTier.PROFESSIONAL;
  if (stakedAmount >= BASIC_MIN) return StakingTier.BASIC;
  return StakingTier.NONE;
}
