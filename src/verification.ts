/**
 * VerificationClient -- wraps NotareumVerificationEngine contract.
 */

import { Contract, type Provider, type Signer } from "ethers";
import { VerificationLevel } from "./core/index.js";
import { NotareumVerificationEngineABI } from "./abi/index.js";
import { SignerRequiredError, ContractCallError } from "./errors.js";

export interface VerificationRequest {
  resourceId: string;
  level: number;
  requester: string;
  feeDeposited: bigint;
  approvals: bigint;
  rejections: bigint;
  resolved: boolean;
}

export class VerificationClient {
  private readonly contract: Contract;
  private readonly signer: Signer | undefined;

  constructor(address: string, provider: Provider, signer?: Signer) {
    this.signer = signer;
    this.contract = new Contract(
      address,
      NotareumVerificationEngineABI,
      signer ?? provider
    );
  }

  /**
   * Request verification for a resource.
   * Matches: requestVerification(bytes32 resourceId, VerificationLevel level) returns (uint256 requestId)
   */
  async requestVerification(
    resourceId: string,
    level: VerificationLevel
  ): Promise<string> {
    if (!this.signer) throw new SignerRequiredError("requestVerification");
    try {
      const tx = await this.contract.requestVerification(resourceId, level);
      return tx.hash as string;
    } catch (err) {
      throw new ContractCallError("requestVerification", err);
    }
  }

  /**
   * Submit an attestation for a verification request.
   * Matches: submitAttestation(bytes32 resourceId, bool approved)
   *
   * Note: The contract's submitAttestation takes (bytes32 resourceId, bool approved).
   * The requestId is looked up internally by the contract based on the pending request for resourceId.
   */
  async submitAttestation(
    resourceId: string,
    approved: boolean
  ): Promise<string> {
    if (!this.signer) throw new SignerRequiredError("submitAttestation");
    try {
      const tx = await this.contract.submitAttestation(resourceId, approved);
      return tx.hash as string;
    } catch (err) {
      throw new ContractCallError("submitAttestation", err);
    }
  }

  /**
   * Get a verification request by ID.
   * Matches: getRequest(uint256 requestId) returns (VerificationRequest)
   */
  async getVerificationRequest(requestId: bigint | number): Promise<VerificationRequest> {
    try {
      const r = await this.contract.getRequest(BigInt(requestId));
      return {
        resourceId: r.resourceId as string,
        level: Number(r.level),
        requester: r.requester as string,
        feeDeposited: BigInt(r.feeDeposited),
        approvals: BigInt(r.approvals),
        rejections: BigInt(r.rejections),
        resolved: r.resolved as boolean,
      };
    } catch (err) {
      throw new ContractCallError("getRequest", err);
    }
  }

  /**
   * Get the fee for a verification level.
   * Reads the corresponding FEE_BASIC / FEE_ENHANCED / FEE_INSTITUTIONAL constant.
   */
  async getVerificationFee(level: VerificationLevel): Promise<bigint> {
    try {
      let fee: unknown;
      if (level === VerificationLevel.BASIC) {
        fee = await this.contract.FEE_BASIC();
      } else if (level === VerificationLevel.ENHANCED) {
        fee = await this.contract.FEE_ENHANCED();
      } else {
        fee = await this.contract.FEE_INSTITUTIONAL();
      }
      return BigInt(fee as bigint);
    } catch (err) {
      throw new ContractCallError("getVerificationFee", err);
    }
  }
}
