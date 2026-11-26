/**
 * FeeClient -- wraps NotareumFeeManager.
 *
 * The fee manager splits collected fees between burn, treasury and
 * validators. It does not set prices: the mint and alias fees are read from
 * the registry (`RegistryClient.mintFee`, `aliasFee`), the verification fees
 * from the verification engine (`VerificationClient.getVerificationFee`).
 *
 * @license MIT
 * @author Notareum Labs
 */

import { getAddress } from "ethers";
import type { Contract, Provider, Signer } from "ethers";
import { NotareumFeeManagerABI } from "../abi/index.js";
import { SignerRequiredError } from "../errors.js";
import { callError, protocolContract } from "../internal/calls.js";

/** `NotareumFeeManager.FeeType`. */
export enum FeeType {
  VERIFICATION = 0,
  ALIAS_REGISTRATION = 1,
  DISPUTE_BOND = 2,
}

/** How the fee manager splits what it collects. Rates are in basis points. */
export interface FeeConfig {
  /** Share of collected fees that is burned. */
  burnRate: bigint;
  /** Share of collected fees sent to the treasury. */
  treasuryRate: bigint;
  treasury: string;
  burnAddress: string;
  /** Fees collected and not yet distributed, in NOTA wei. */
  pendingFees: bigint;
}

export class FeeClient {
  public readonly address: string;
  private readonly read: Contract;
  private readonly write: Contract | undefined;

  constructor(address: string, provider: Provider, signer?: Signer) {
    this.address = getAddress(address);
    this.read = protocolContract(this.address, NotareumFeeManagerABI, provider);
    this.write = signer ? protocolContract(this.address, NotareumFeeManagerABI, signer) : undefined;
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
   * The current split and what is waiting to be distributed.
   *
   * Matches: burnRate(), treasuryRate(), treasury(), burnAddress(), pendingFees()
   */
  async getFeeConfig(): Promise<FeeConfig> {
    try {
      const [burnRate, treasuryRate, treasury, burnAddress, pendingFees] = await Promise.all([
        this.read.burnRate(),
        this.read.treasuryRate(),
        this.read.treasury(),
        this.read.burnAddress(),
        this.read.pendingFees(),
      ]);
      return {
        burnRate: BigInt(burnRate),
        treasuryRate: BigInt(treasuryRate),
        treasury: getAddress(treasury as string),
        burnAddress: getAddress(burnAddress as string),
        pendingFees: BigInt(pendingFees),
      };
    } catch (err) {
      throw callError("getFeeConfig", err);
    }
  }

  /**
   * Total fees of one type collected so far, in NOTA wei.
   *
   * Matches: feesCollectedByType(FeeType) returns (uint256)
   */
  async getFeesCollected(feeType: FeeType): Promise<bigint> {
    try {
      return BigInt(await this.read.feesCollectedByType(feeType));
    } catch (err) {
      throw callError("feesCollectedByType", err);
    }
  }

  /**
   * A validator's share of distributed fees that it has not claimed yet.
   *
   * Matches: pendingReward(address validator) returns (uint256)
   */
  async getPendingReward(validator: string): Promise<bigint> {
    try {
      return BigInt(await this.read.pendingReward(getAddress(validator)));
    } catch (err) {
      throw callError("pendingReward", err);
    }
  }

  /**
   * Claims the caller's share of distributed fees.
   *
   * Matches: claimReward()
   */
  async claimReward(): Promise<string> {
    return this.send("claimReward");
  }

  /**
   * Updates the burn rate (governance). At most 5,000 basis points.
   *
   * Matches: setBurnRate(uint256 rate)
   */
  async setBurnRate(rate: bigint): Promise<string> {
    return this.send("setBurnRate", rate);
  }

  /**
   * Updates the treasury rate (governance). At most 5,000 basis points.
   *
   * Matches: setTreasuryRate(uint256 rate)
   */
  async setTreasuryRate(rate: bigint): Promise<string> {
    return this.send("setTreasuryRate", rate);
  }
}
