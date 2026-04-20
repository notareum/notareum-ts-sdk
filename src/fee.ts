/**
 * FeeClient -- wraps NotareumFeeManager contract.
 *
 * @license BUSL-1.1
 * @author Notareum Labs
 */

import { Contract, type Provider, type Signer } from "ethers";
import { NotareumFeeManagerABI } from "./abi/index.js";
import { SignerRequiredError, ContractCallError } from "./errors.js";

/** Fee configuration from the protocol. */
export interface FeeConfig {
  verificationFee: bigint;
  aliasFee: bigint;
  disputeBond: bigint;
  feeCollector: string;
}

export class FeeClient {
  private readonly contract: Contract;
  private readonly signer: Signer | undefined;

  constructor(address: string, provider: Provider, signer?: Signer) {
    this.signer = signer;
    this.contract = new Contract(
      address,
      NotareumFeeManagerABI,
      signer ?? provider
    );
  }

  /**
   * Get current verification fee for a given level (0=BASIC, 1=ENHANCED, 2=INSTITUTIONAL).
   * Matches: getVerificationFee(uint8 level) returns (uint256)
   */
  async getVerificationFee(level: number): Promise<bigint> {
    try {
      return BigInt(await this.contract.getVerificationFee(level));
    } catch (err) {
      throw new ContractCallError("getVerificationFee", err);
    }
  }

  /**
   * Get the alias registration fee.
   * Matches: aliasFee() returns (uint256)
   */
  async getAliasFee(): Promise<bigint> {
    try {
      return BigInt(await this.contract.aliasFee());
    } catch (err) {
      throw new ContractCallError("aliasFee", err);
    }
  }

  /**
   * Get the dispute bond amount.
   * Matches: disputeBond() returns (uint256)
   */
  async getDisputeBond(): Promise<bigint> {
    try {
      return BigInt(await this.contract.disputeBond());
    } catch (err) {
      throw new ContractCallError("disputeBond", err);
    }
  }

  /**
   * Get the fee collector address.
   * Matches: feeCollector() returns (address)
   */
  async getFeeCollector(): Promise<string> {
    try {
      return await this.contract.feeCollector() as string;
    } catch (err) {
      throw new ContractCallError("feeCollector", err);
    }
  }

  /**
   * Collect all fee config in a single call.
   */
  async getFeeConfig(): Promise<FeeConfig> {
    const [verificationFee, aliasFee, disputeBond, feeCollector] = await Promise.all([
      this.getVerificationFee(0),
      this.getAliasFee(),
      this.getDisputeBond(),
      this.getFeeCollector(),
    ]);
    return { verificationFee, aliasFee, disputeBond, feeCollector };
  }

  /**
   * Update the verification fee (governance).
   * Matches: setVerificationFee(uint8 level, uint256 fee)
   */
  async setVerificationFee(level: number, fee: bigint): Promise<string> {
    if (!this.signer) throw new SignerRequiredError("setVerificationFee");
    try {
      const tx = await this.contract.setVerificationFee(level, fee);
      return tx.hash as string;
    } catch (err) {
      throw new ContractCallError("setVerificationFee", err);
    }
  }

  /**
   * Update the alias fee (governance).
   * Matches: setAliasFee(uint256 fee)
   */
  async setAliasFee(fee: bigint): Promise<string> {
    if (!this.signer) throw new SignerRequiredError("setAliasFee");
    try {
      const tx = await this.contract.setAliasFee(fee);
      return tx.hash as string;
    } catch (err) {
      throw new ContractCallError("setAliasFee", err);
    }
  }
}
