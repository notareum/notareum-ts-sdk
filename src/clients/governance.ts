/**
 * GovernanceClient -- wraps NotareumVeNOTA contract.
 *
 * @license BUSL-1.1
 * @author Notareum Labs
 */

import { Contract, type Provider, type Signer } from "ethers";
import { NotareumVeNOTAABI } from "../abi/index.js";
import { SignerRequiredError, ContractCallError } from "../errors.js";

/** A veNOTA lock record. */
export interface VeNOTALock {
  lockId: bigint;
  amount: bigint;
  unlockTime: bigint;
  votingPower: bigint;
}

export class GovernanceClient {
  private readonly contract: Contract;
  private readonly signer: Signer | undefined;

  constructor(address: string, provider: Provider, signer?: Signer) {
    this.signer = signer;
    this.contract = new Contract(
      address,
      NotareumVeNOTAABI,
      signer ?? provider
    );
  }

  /**
   * Lock NOTA tokens to receive veNOTA voting power.
   * Requires prior approval of NOTA token allowance.
   * Matches: lock(uint256 amount, uint256 duration) returns (uint256 lockId)
   */
  async lock(amount: bigint, duration: bigint): Promise<string> {
    if (!this.signer) throw new SignerRequiredError("lock");
    try {
      const tx = await this.contract.lock(amount, duration);
      return tx.hash as string;
    } catch (err) {
      throw new ContractCallError("lock", err);
    }
  }

  /**
   * Extend an existing lock duration.
   * Matches: extendLock(uint256 lockId, uint256 additionalDuration)
   */
  async extendLock(lockId: bigint, additionalDuration: bigint): Promise<string> {
    if (!this.signer) throw new SignerRequiredError("extendLock");
    try {
      const tx = await this.contract.extendLock(lockId, additionalDuration);
      return tx.hash as string;
    } catch (err) {
      throw new ContractCallError("extendLock", err);
    }
  }

  /**
   * Unlock and withdraw NOTA after the lock has expired.
   * Matches: unlock(uint256 lockId)
   */
  async unlock(lockId: bigint): Promise<string> {
    if (!this.signer) throw new SignerRequiredError("unlock");
    try {
      const tx = await this.contract.unlock(lockId);
      return tx.hash as string;
    } catch (err) {
      throw new ContractCallError("unlock", err);
    }
  }

  /**
   * Get the total voting power (veNOTA balance) for an address.
   * Matches: votingPower(address) returns (uint256)
   */
  async getVotingPower(address: string): Promise<bigint> {
    try {
      return BigInt(await this.contract.votingPower(address));
    } catch (err) {
      throw new ContractCallError("votingPower", err);
    }
  }

  /**
   * Get a specific lock record.
   * Matches: getLock(uint256 lockId) returns (Lock)
   */
  async getLock(lockId: bigint): Promise<VeNOTALock> {
    try {
      const l = await this.contract.getLock(lockId);
      return {
        lockId,
        amount: BigInt(l.amount),
        unlockTime: BigInt(l.unlockTime),
        votingPower: BigInt(l.votingPower),
      };
    } catch (err) {
      throw new ContractCallError("getLock", err);
    }
  }

  /**
   * Get the total veNOTA supply.
   * Matches: totalSupply() returns (uint256)
   */
  async getTotalSupply(): Promise<bigint> {
    try {
      return BigInt(await this.contract.totalSupply());
    } catch (err) {
      throw new ContractCallError("totalSupply", err);
    }
  }
}
