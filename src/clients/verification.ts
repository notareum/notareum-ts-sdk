/**
 * VerificationClient -- wraps NotareumVerificationEngine (v1.1).
 *
 * This is social verification: staked validators attest to a minted file and
 * a quorum decides. It is the optional second stage after registry
 * verification, which every file gets by being minted. Requests and
 * attestations are keyed by `notaId`.
 *
 * @license MIT
 * @author Notareum Labs
 */

import { getAddress, isHexString } from "ethers";
import type { Contract, Provider, Signer } from "ethers";
import { NotareumVerificationEngineABI } from "../abi/index.js";
import { VerificationLevel } from "../core/index.js";
import { SignerRequiredError } from "../errors.js";
import { callError, protocolContract } from "../internal/calls.js";

/** `NotareumVerificationEngine.VerificationRequest`. */
export interface VerificationRequest {
  requestId: bigint;
  /** The file the request is for. */
  notaId: string;
  level: VerificationLevel;
  requester: string;
  feeDeposited: bigint;
  approvals: bigint;
  rejections: bigint;
  resolved: boolean;
}

/** Attestation counts of a file's open request. */
export interface AttestationCounts {
  /** The open request, or 0 when the file has none. */
  requestId: bigint;
  approvals: bigint;
  rejections: bigint;
  resolved: boolean;
}

function requireNotaId(notaId: string): string {
  if (!isHexString(notaId, 32)) throw new TypeError("notaId must be a 32-byte hex value");
  return notaId.toLowerCase();
}

export class VerificationClient {
  public readonly address: string;
  private readonly read: Contract;
  private readonly write: Contract | undefined;

  constructor(address: string, provider: Provider, signer?: Signer) {
    this.address = getAddress(address);
    this.read = protocolContract(this.address, NotareumVerificationEngineABI, provider);
    this.write = signer ? protocolContract(this.address, NotareumVerificationEngineABI, signer) : undefined;
  }

  /**
   * Requests social verification of a minted file. Any account may submit and
   * pay; it need not be the issuer. The engine pulls the level's fee in NOTA,
   * so the caller must have approved it to the engine first.
   *
   * The file must be REGISTERED, unexpired and its issuer's current file for
   * the resource, and no other issuer may hold the resource's canonical slot
   * (`RegistryClient.isVerifiable`).
   *
   * Matches: requestVerification(bytes32 notaId, VerificationLevel level) returns (uint256 requestId)
   * @returns The transaction hash.
   */
  async requestVerification(notaId: string, level: VerificationLevel): Promise<string> {
    if (!this.write) throw new SignerRequiredError("requestVerification");
    const id = requireNotaId(notaId);
    try {
      await this.write.requestVerification.staticCall(id, level);
      const tx = await this.write.requestVerification(id, level);
      return tx.hash as string;
    } catch (err) {
      throw callError("requestVerification", err);
    }
  }

  /**
   * Submits a validator's vote on a file's open request. The engine finds the
   * request from the `notaId`.
   *
   * Matches: submitAttestation(bytes32 notaId, bool approved)
   * @returns The transaction hash.
   */
  async submitAttestation(notaId: string, approved: boolean): Promise<string> {
    if (!this.write) throw new SignerRequiredError("submitAttestation");
    const id = requireNotaId(notaId);
    try {
      await this.write.submitAttestation.staticCall(id, approved);
      const tx = await this.write.submitAttestation(id, approved);
      return tx.hash as string;
    } catch (err) {
      throw callError("submitAttestation", err);
    }
  }

  /**
   * Attestation counts of a file's open request. `requestId` is 0 when the
   * file has no open request.
   *
   * Matches: getAttestations(bytes32 notaId)
   */
  async getAttestations(notaId: string): Promise<AttestationCounts> {
    try {
      const r = await this.read.getAttestations(requireNotaId(notaId));
      return {
        requestId: BigInt(r.requestId),
        approvals: BigInt(r.approvals),
        rejections: BigInt(r.rejections),
        resolved: r.resolved as boolean,
      };
    } catch (err) {
      throw callError("getAttestations", err);
    }
  }

  /**
   * Get a verification request by ID, or `null` if there is no such request.
   * Matches: getRequest(uint256 requestId) returns (VerificationRequest)
   */
  async getVerificationRequest(requestId: bigint | number): Promise<VerificationRequest | null> {
    try {
      const r = await this.read.getRequest(BigInt(requestId));
      if (/^0x0{40}$/.test(r.requester as string)) return null;
      return {
        requestId: BigInt(requestId),
        notaId: (r.notaId as string).toLowerCase(),
        level: Number(r.level),
        requester: getAddress(r.requester as string),
        feeDeposited: BigInt(r.feeDeposited),
        approvals: BigInt(r.approvals),
        rejections: BigInt(r.rejections),
        resolved: r.resolved as boolean,
      };
    } catch (err) {
      throw callError("getRequest", err);
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
        fee = await this.read.FEE_BASIC();
      } else if (level === VerificationLevel.ENHANCED) {
        fee = await this.read.FEE_ENHANCED();
      } else {
        fee = await this.read.FEE_INSTITUTIONAL();
      }
      return BigInt(fee as bigint);
    } catch (err) {
      throw callError("getVerificationFee", err);
    }
  }

  /** Number of attestations a level's request needs before it resolves. */
  async getQuorum(level: VerificationLevel): Promise<number> {
    try {
      let quorum: unknown;
      if (level === VerificationLevel.BASIC) {
        quorum = await this.read.QUORUM_BASIC();
      } else if (level === VerificationLevel.ENHANCED) {
        quorum = await this.read.QUORUM_ENHANCED();
      } else {
        quorum = await this.read.QUORUM_INSTITUTIONAL();
      }
      return Number(quorum);
    } catch (err) {
      throw callError("getQuorum", err);
    }
  }
}
