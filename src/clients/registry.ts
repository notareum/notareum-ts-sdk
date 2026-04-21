/**
 * RegistryClient -- wraps NotareumNotaRegistry contract.
 */

import { Contract, type Provider, type Signer } from "ethers";
import { computeResourceId } from "../core/index.js";
import type { ResourceInfo } from "../core/index.js";
import { NotareumNotaRegistryABI } from "../abi/index.js";
import { SignerRequiredError, ContractCallError } from "../errors.js";

export class RegistryClient {
  private readonly contract: Contract;
  private readonly signer: Signer | undefined;

  constructor(address: string, provider: Provider, signer?: Signer) {
    this.signer = signer;
    this.contract = new Contract(
      address,
      NotareumNotaRegistryABI,
      signer ?? provider
    );
  }

  /**
   * Register a new resource.
   * Matches: register(uint8 resourceType, uint256 chainId, bytes identifier, bytes32 proofHash, string alias_)
   */
  async registerResource(
    resourceType: number,
    chainId: bigint | number,
    identifier: string,
    proofHash: string,
    alias = ""
  ): Promise<string> {
    if (!this.signer) throw new SignerRequiredError("registerResource");
    try {
      const identifierBytes = new TextEncoder().encode(identifier);
      const tx = await this.contract.register(
        resourceType,
        BigInt(chainId),
        identifierBytes,
        proofHash,
        alias
      );
      return tx.hash as string;
    } catch (err) {
      throw new ContractCallError("register", err);
    }
  }

  /**
   * Get resource info by ID.
   * Matches: getResource(bytes32 resourceId) returns (NotaResource)
   */
  async getResource(resourceId: string): Promise<ResourceInfo> {
    try {
      const r = await this.contract.getResource(resourceId);
      return {
        resourceId,
        owner: r.owner as string,
        resourceType: Number(r.resourceType),
        chainId: BigInt(r.chainId),
        identifier: new TextDecoder().decode(r.identifier as Uint8Array),
        alias: r.alias_ as string,
        verificationStatus: Number(r.verificationStatus),
        registeredAt: BigInt(r.registeredAt),
        proofHash: r.proofHash as string,
      };
    } catch (err) {
      throw new ContractCallError("getResource", err);
    }
  }

  /**
   * Resolve an alias to a resourceId.
   * Matches: resolveAlias(string alias_) returns (bytes32)
   */
  async resolveAlias(alias: string): Promise<string> {
    try {
      return await this.contract.resolveAlias(alias) as string;
    } catch (err) {
      throw new ContractCallError("resolveAlias", err);
    }
  }

  /**
   * Revoke a resource.
   * Matches: revokeResource(bytes32 resourceId)
   */
  async revokeResource(resourceId: string): Promise<string> {
    if (!this.signer) throw new SignerRequiredError("revokeResource");
    try {
      const tx = await this.contract.revokeResource(resourceId);
      return tx.hash as string;
    } catch (err) {
      throw new ContractCallError("revokeResource", err);
    }
  }

  /**
   * Compute the resource ID locally using @notareum/core.
   * No on-chain call needed.
   */
  computeResourceId(
    resourceType: number,
    chainId: number | bigint,
    identifier: string
  ): string {
    return computeResourceId(resourceType, chainId, identifier);
  }

  /**
   * Add a new resource type (governance).
   * Matches: addResourceType(uint8 typeId, string name)
   */
  async addResourceType(typeId: number, name: string): Promise<string> {
    if (!this.signer) throw new SignerRequiredError("addResourceType");
    try {
      const tx = await this.contract.addResourceType(typeId, name);
      return tx.hash as string;
    } catch (err) {
      throw new ContractCallError("addResourceType", err);
    }
  }

  /**
   * Remove a resource type (governance).
   * Matches: removeResourceType(uint8 typeId)
   */
  async removeResourceType(typeId: number): Promise<string> {
    if (!this.signer) throw new SignerRequiredError("removeResourceType");
    try {
      const tx = await this.contract.removeResourceType(typeId);
      return tx.hash as string;
    } catch (err) {
      throw new ContractCallError("removeResourceType", err);
    }
  }

  /**
   * Check if a resource type is valid.
   * Matches: validResourceTypes(uint8) returns (bool)
   */
  async isValidResourceType(typeId: number): Promise<boolean> {
    try {
      return await this.contract.validResourceTypes(typeId) as boolean;
    } catch (err) {
      throw new ContractCallError("validResourceTypes", err);
    }
  }

  /**
   * Get the name of a resource type.
   * Matches: resourceTypeNames(uint8) returns (string)
   */
  async getResourceTypeName(typeId: number): Promise<string> {
    try {
      return await this.contract.resourceTypeNames(typeId) as string;
    } catch (err) {
      throw new ContractCallError("resourceTypeNames", err);
    }
  }
}
