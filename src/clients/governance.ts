/**
 * GovernanceClient -- wraps NotareumVeNOTA.
 *
 * veNOTA is an ERC-721 (enumerable): every lock is its own NFT, identified by
 * a token ID. An account's voting power is the sum over the locks it owns,
 * and each lock's power decays linearly to zero at its expiry.
 *
 * @license MIT
 * @author Notareum Labs
 */

import { getAddress } from "ethers";
import type { Contract, Provider, Signer } from "ethers";
import { NotareumVeNOTAABI } from "../abi/index.js";
import { SignerRequiredError } from "../errors.js";
import { callError, protocolContract } from "../internal/calls.js";

/** A veNOTA lock position. */
export interface VeNOTALock {
  /** The NFT token ID of the lock. */
  tokenId: bigint;
  /** NOTA locked, in wei. */
  amount: bigint;
  /** Unix seconds when the lock was created or last extended. */
  lockStart: bigint;
  /** Unix seconds when the lock expires and the NOTA can be withdrawn. */
  lockEnd: bigint;
  /** Current voting power of the lock. Zero once it has expired. */
  votingPower: bigint;
}

export class GovernanceClient {
  public readonly address: string;
  private readonly read: Contract;
  private readonly write: Contract | undefined;

  constructor(address: string, provider: Provider, signer?: Signer) {
    this.address = getAddress(address);
    this.read = protocolContract(this.address, NotareumVeNOTAABI, provider);
    this.write = signer ? protocolContract(this.address, NotareumVeNOTAABI, signer) : undefined;
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
   * Locks NOTA for `duration` seconds (91 to 1,461 days) and mints the lock
   * as an NFT to the caller. Requires a NOTA allowance for the veNOTA
   * contract. The new token ID is in the transaction's `LockCreated` event.
   *
   * Matches: createLock(uint256 amount, uint256 duration) returns (uint256 tokenId)
   */
  async createLock(amount: bigint, duration: bigint | number): Promise<string> {
    return this.send("createLock", amount, BigInt(duration));
  }

  /**
   * Adds NOTA to a lock the caller owns. Requires a NOTA allowance.
   *
   * Matches: increaseLockAmount(uint256 tokenId, uint256 amount)
   */
  async increaseLockAmount(tokenId: bigint, amount: bigint): Promise<string> {
    return this.send("increaseLockAmount", tokenId, amount);
  }

  /**
   * Re-locks a lock for `newDuration` seconds counted from now. The new
   * expiry must be later than the current one.
   *
   * Matches: extendLock(uint256 tokenId, uint256 newDuration)
   */
  async extendLock(tokenId: bigint, newDuration: bigint | number): Promise<string> {
    return this.send("extendLock", tokenId, BigInt(newDuration));
  }

  /**
   * Withdraws the NOTA of an expired lock and burns its NFT.
   *
   * Matches: withdraw(uint256 tokenId)
   */
  async withdraw(tokenId: bigint): Promise<string> {
    return this.send("withdraw", tokenId);
  }

  /**
   * A lock position and its current voting power. A token ID that does not
   * exist (or whose lock was withdrawn) returns zeros.
   *
   * Matches: lockInfo(uint256 tokenId), votingPower(uint256 tokenId)
   */
  async getLock(tokenId: bigint): Promise<VeNOTALock> {
    try {
      const [info, power] = await Promise.all([this.read.lockInfo(tokenId), this.read.votingPower(tokenId)]);
      return {
        tokenId,
        amount: BigInt(info.amount),
        lockStart: BigInt(info.lockStart),
        lockEnd: BigInt(info.lockEnd),
        votingPower: BigInt(power),
      };
    } catch (err) {
      throw callError("lockInfo", err);
    }
  }

  /**
   * Token IDs of the locks an account owns.
   *
   * Matches: balanceOf(address), tokenOfOwnerByIndex(address, uint256)
   */
  async getLockIds(owner: string): Promise<bigint[]> {
    try {
      const account = getAddress(owner);
      const count = Number(await this.read.balanceOf(account));
      const ids = await Promise.all(
        Array.from({ length: count }, (_, index) => this.read.tokenOfOwnerByIndex(account, index))
      );
      return ids.map((id) => BigInt(id as bigint));
    } catch (err) {
      throw callError("tokenOfOwnerByIndex", err);
    }
  }

  /** The locks an account owns, with their current voting power. */
  async getLocks(owner: string): Promise<VeNOTALock[]> {
    const ids = await this.getLockIds(owner);
    return Promise.all(ids.map((id) => this.getLock(id)));
  }

  /**
   * Current voting power of one lock.
   *
   * Matches: votingPower(uint256 tokenId) returns (uint256)
   */
  async getLockVotingPower(tokenId: bigint): Promise<bigint> {
    try {
      return BigInt(await this.read.votingPower(tokenId));
    } catch (err) {
      throw callError("votingPower", err);
    }
  }

  /** Current voting power of an account: the sum over the locks it owns. */
  async getVotingPower(owner: string): Promise<bigint> {
    const locks = await this.getLocks(owner);
    return locks.reduce((total, lock) => total + lock.votingPower, 0n);
  }

  /**
   * Current voting power of all locks together.
   *
   * Matches: totalVotingPower() returns (uint256)
   */
  async getTotalVotingPower(): Promise<bigint> {
    try {
      return BigInt(await this.read.totalVotingPower());
    } catch (err) {
      throw callError("totalVotingPower", err);
    }
  }

  /**
   * Number of locks in existence. This is the ERC-721 `totalSupply`, a count
   * of NFTs; it is not an amount of NOTA or of voting power.
   *
   * Matches: totalSupply() returns (uint256)
   */
  async getLockCount(): Promise<bigint> {
    try {
      return BigInt(await this.read.totalSupply());
    } catch (err) {
      throw callError("totalSupply", err);
    }
  }

  /**
   * The account that owns a lock.
   *
   * Matches: ownerOf(uint256 tokenId) returns (address)
   */
  async getLockOwner(tokenId: bigint): Promise<string> {
    try {
      return getAddress((await this.read.ownerOf(tokenId)) as string);
    } catch (err) {
      throw callError("ownerOf", err);
    }
  }
}
