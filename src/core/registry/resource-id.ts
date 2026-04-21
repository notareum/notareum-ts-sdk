/**
 * Computes the on-chain resource ID for a given resource.
 * Delegates to the crypto/hash module which matches the contract exactly.
 */

import { computeResourceIdHash } from "../crypto/hash.js";
import { ResourceIdError } from "../errors.js";

/**
 * Computes the resource ID matching NotareumNotaRegistry._computeResourceId.
 * Formula: keccak256(abi.encodePacked(uint8(resourceType), uint256(chainId), bytes(identifier)))
 *
 * @param resourceType - uint8 type ID (well-known or governance-added).
 * @param chainId - Chain ID (number or bigint).
 * @param identifier - Resource identifier string.
 * @returns bytes32 hex string (0x-prefixed).
 * @throws ResourceIdError on invalid inputs.
 */
export function computeResourceId(
  resourceType: number,
  chainId: number | bigint,
  identifier: string
): string {
  if (typeof resourceType !== "number" || !Number.isInteger(resourceType) || resourceType < 0 || resourceType > 255) {
    throw new ResourceIdError(
      `Invalid resourceType: ${resourceType}. Must be a uint8 (0-255).`
    );
  }
  if (!identifier || identifier.trim() === "") {
    throw new ResourceIdError("identifier must be a non-empty string.");
  }
  try {
    return computeResourceIdHash(resourceType, chainId, identifier);
  } catch (err) {
    throw new ResourceIdError(
      `Failed to compute resource ID: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
