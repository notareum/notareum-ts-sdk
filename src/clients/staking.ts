/**
 * StakingClient -- wraps NotareumValidatorStaking.
 *
 * @license MIT
 * @author Notareum Labs
 */

import { getAddress } from "ethers";
import type { Contract, Provider, Signer } from "ethers";
import { NotareumValidatorStakingABI } from "../abi/index.js";
import { StakingTier, TIER_DAILY_LIMITS, TIER_MINIMUMS } from "../core/index.js";
import { SignerRequiredError } from "../errors.js";
import { callError, protocolContract } from "../internal/calls.js";

/** `NotareumValidatorStaking.ValidatorInfo`. */
export interface ValidatorInfo {
  /** NOTA staked, in wei. Excludes amounts that are unbonding. */
  stakedAmount: bigint;
  /** Tier the stake qualifies for. `NONE` below the 10,000 NOTA minimum. */
  tier: StakingTier;
  accuracyNumerator: bigint;
  accuracyDenominator: bigint;
  /** Attestations submitted over the validator's lifetime. */
  verificationCount: bigint;
  /** Rewards accrued and not yet claimed, in wei. */
  rewardsAccrued: bigint;
  /** Attestations submitted on `lastResetDay`. */
  dailyVerifications: bigint;
  /** The day (Unix time / 86,400) `dailyVerifications` counts for. */
  lastResetDay: bigint;
}

/** `NotareumValidatorStaking.UnbondingRequest`, with its position in the contract's array. */
export interface UnbondingRequest {
  index: number;
  amount: bigint;
  /** Unix seconds from which the amount can be withdrawn. */
  releaseTime: bigint;
  claimed: boolean;
}

const SECONDS_PER_DAY = 86_400n;

export class StakingClient {
  public readonly address: string;
  private readonly provider: Provider;
  private readonly read: Contract;
  private readonly write: Contract | undefined;

  constructor(address: string, provider: Provider, signer?: Signer) {
    this.address = getAddress(address);
    this.provider = provider;
    this.read = protocolContract(this.address, NotareumValidatorStakingABI, provider);
    this.write = signer ? protocolContract(this.address, NotareumValidatorStakingABI, signer) : undefined;
  }

  private async send(method: string, ...args: unknown[]): Promise<string> {
    if (!this.write) throw new SignerRequiredError(method);
    try {
      await this.write[method].staticCall(...args);
      const tx = await this.write[method](...args);
      return tx.hash as string;
    } catch (err) {
      throw callError(method, err);
    }
  }

  /**
   * Stake NOTA to become a validator, or add to an existing stake. The total
   * must reach the 10,000 NOTA minimum. Requires a NOTA allowance for the
   * staking contract.
   *
   * Matches: stake(uint256 amount)
   */
  async stake(amount: bigint): Promise<string> {
    return this.send("stake", amount);
  }

  /**
   * Starts unbonding `amount` of the stake. It leaves the stake at once and
   * can be withdrawn with {@link completeUnstake} after 14 days.
   *
   * Matches: requestUnstake(uint256 amount)
   */
  async requestUnstake(amount: bigint): Promise<string> {
    return this.send("requestUnstake", amount);
  }

  /**
   * Withdraws every unbonding request whose release time has passed.
   *
   * Matches: completeUnstake()
   */
  async completeUnstake(): Promise<string> {
    return this.send("completeUnstake");
  }

  /**
   * Claims the caller's accrued rewards.
   *
   * Matches: claimRewards()
   */
  async claimRewards(): Promise<string> {
    return this.send("claimRewards");
  }

  /**
   * Get full validator info for an address. An address that never staked
   * returns zeros and tier `NONE`.
   *
   * Matches: getValidatorInfo(address) returns (ValidatorInfo)
   */
  async getValidatorInfo(address: string): Promise<ValidatorInfo> {
    try {
      const v = await this.read.getValidatorInfo(getAddress(address));
      return {
        stakedAmount: BigInt(v.stakedAmount),
        tier: Number(v.tier) as StakingTier,
        accuracyNumerator: BigInt(v.accuracyNumerator),
        accuracyDenominator: BigInt(v.accuracyDenominator),
        verificationCount: BigInt(v.verificationCount),
        rewardsAccrued: BigInt(v.rewardsAccrued),
        dailyVerifications: BigInt(v.dailyVerifications),
        lastResetDay: BigInt(v.lastResetDay),
      };
    } catch (err) {
      throw callError("getValidatorInfo", err);
    }
  }

  /**
   * True when the address has at least the minimum stake and may attest.
   *
   * Matches: isValidator(address) returns (bool)
   */
  async isValidator(address: string): Promise<boolean> {
    try {
      return (await this.read.isValidator(getAddress(address))) as boolean;
    } catch (err) {
      throw callError("isValidator", err);
    }
  }

  /** The tier an address's current stake qualifies for. */
  async getTier(address: string): Promise<StakingTier> {
    return (await this.getValidatorInfo(address)).tier;
  }

  /**
   * Every unbonding request an address has made, claimed ones included.
   *
   * Matches: getUnbondingRequests(address) returns (UnbondingRequest[])
   */
  async getUnbondingRequests(address: string): Promise<UnbondingRequest[]> {
    try {
      const requests = (await this.read.getUnbondingRequests(getAddress(address))) as Array<{
        amount: bigint;
        releaseTime: bigint;
        claimed: boolean;
      }>;
      return requests.map((r, index) => ({
        index,
        amount: BigInt(r.amount),
        releaseTime: BigInt(r.releaseTime),
        claimed: r.claimed,
      }));
    } catch (err) {
      throw callError("getUnbondingRequests", err);
    }
  }

  /**
   * Attestations a validator may still submit today, or `null` for the
   * unlimited INSTITUTIONAL tier. Computed from the validator's record and
   * the chain's clock the way `recordVerification` does it: the count resets
   * when a new UTC day begins.
   */
  async getDailyVerificationsRemaining(address: string): Promise<bigint | null> {
    const info = await this.getValidatorInfo(address);
    const limit = TIER_DAILY_LIMITS[info.tier];
    if (limit === null) return null;
    let now: bigint;
    try {
      const block = await this.provider.getBlock("latest");
      now = BigInt(block?.timestamp ?? Math.floor(Date.now() / 1000));
    } catch (err) {
      throw callError("getBlock", err);
    }
    const used = info.lastResetDay < now / SECONDS_PER_DAY ? 0n : info.dailyVerifications;
    const left = BigInt(limit) - used;
    return left > 0n ? left : 0n;
  }

  /**
   * Minimum stake of a tier in NOTA wei, or `null` for `NONE`. These are
   * constants of the staking contract (`BASIC_MIN` and so on).
   */
  getTierMinimum(tier: StakingTier): bigint | null {
    return TIER_MINIMUMS[tier];
  }

  /**
   * Share of a validator's stake slashed on a guilty verdict, in basis points.
   *
   * Matches: slashRateForTier(Tier) returns (uint256)
   */
  async getSlashRate(tier: StakingTier): Promise<bigint> {
    try {
      return BigInt(await this.read.slashRateForTier(tier));
    } catch (err) {
      throw callError("slashRateForTier", err);
    }
  }
}

export { StakingTier };
