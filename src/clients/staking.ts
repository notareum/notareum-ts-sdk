/**
 * StakingClient -- wraps NotareumValidatorStaking contract.
 *
 * @license MIT
 * @author Notareum Labs
 */

import { Contract, type Provider, type Signer } from "ethers";
import { NotareumValidatorStakingABI } from "../abi/index.js";
import { SignerRequiredError, ContractCallError } from "../errors.js";

/** Validator tier (mirrors NotareumValidatorStaking.Tier). */
export enum ValidatorTier {
  NONE = 0,
  BRONZE = 1,
  SILVER = 2,
  GOLD = 3,
  PLATINUM = 4,
}

/** On-chain validator info. */
export interface ValidatorInfo {
  stakedAmount: bigint;
  tier: ValidatorTier;
  isActive: boolean;
  slashCount: number;
  dailyVerifications: bigint;
  lastVerificationDay: bigint;
  unbondingAmount: bigint;
  unbondingEndTime: bigint;
}

export class StakingClient {
  private readonly contract: Contract;
  private readonly signer: Signer | undefined;

  constructor(address: string, provider: Provider, signer?: Signer) {
    this.signer = signer;
    this.contract = new Contract(
      address,
      NotareumValidatorStakingABI,
      signer ?? provider
    );
  }

  /**
   * Stake NOTA tokens to become a validator.
   * Requires prior approval of NOTA token allowance.
   * Matches: stake(uint256 amount)
   */
  async stake(amount: bigint): Promise<string> {
    if (!this.signer) throw new SignerRequiredError("stake");
    try {
      const tx = await this.contract.stake(amount);
      return tx.hash as string;
    } catch (err) {
      throw new ContractCallError("stake", err);
    }
  }

  /**
   * Initiate the unbonding process.
   * Matches: unstake()
   */
  async unstake(): Promise<string> {
    if (!this.signer) throw new SignerRequiredError("unstake");
    try {
      const tx = await this.contract.unstake();
      return tx.hash as string;
    } catch (err) {
      throw new ContractCallError("unstake", err);
    }
  }

  /**
   * Claim staked tokens after the unbonding period has elapsed.
   * Matches: claimStake()
   */
  async claimStake(): Promise<string> {
    if (!this.signer) throw new SignerRequiredError("claimStake");
    try {
      const tx = await this.contract.claimStake();
      return tx.hash as string;
    } catch (err) {
      throw new ContractCallError("claimStake", err);
    }
  }

  /**
   * Get full validator info for an address.
   * Matches: getValidator(address) returns (ValidatorInfo)
   */
  async getValidatorInfo(address: string): Promise<ValidatorInfo> {
    try {
      const v = await this.contract.getValidator(address);
      return {
        stakedAmount: BigInt(v.stakedAmount),
        tier: Number(v.tier) as ValidatorTier,
        isActive: v.isActive as boolean,
        slashCount: Number(v.slashCount),
        dailyVerifications: BigInt(v.dailyVerifications),
        lastVerificationDay: BigInt(v.lastVerificationDay),
        unbondingAmount: BigInt(v.unbondingAmount),
        unbondingEndTime: BigInt(v.unbondingEndTime),
      };
    } catch (err) {
      throw new ContractCallError("getValidator", err);
    }
  }

  /**
   * Get the current tier for an address.
   * Matches: getTier(address) returns (Tier)
   */
  async getTier(address: string): Promise<ValidatorTier> {
    try {
      const tier = await this.contract.getTier(address);
      return Number(tier) as ValidatorTier;
    } catch (err) {
      throw new ContractCallError("getTier", err);
    }
  }

  /**
   * Get the remaining daily verifications for a validator.
   * Matches: getDailyVerificationsRemaining(address) returns (uint256)
   */
  async getDailyVerificationsRemaining(address: string): Promise<bigint> {
    try {
      return BigInt(await this.contract.getDailyVerificationsRemaining(address));
    } catch (err) {
      throw new ContractCallError("getDailyVerificationsRemaining", err);
    }
  }

  /**
   * Get the minimum stake required for a given tier.
   * Matches: TIER_THRESHOLDS(uint8) or similar view.
   */
  async getTierThreshold(tier: ValidatorTier): Promise<bigint> {
    try {
      return BigInt(await this.contract.TIER_THRESHOLDS(tier));
    } catch (err) {
      throw new ContractCallError("TIER_THRESHOLDS", err);
    }
  }
}
