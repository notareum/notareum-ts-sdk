/**
 * Resource ID computation matching NotareumNotaRegistry._computeResourceId exactly.
 *
 * Contract implementation:
 *   keccak256(abi.encodePacked(resourceType, chainId, identifier))
 *
 * Where:
 *   resourceType is uint8 (enum packed as 1 byte by Solidity)
 *   chainId is uint256 (32 bytes, big-endian)
 *   identifier is bytes (variable length, no length prefix)
 */

import { keccak256, concat } from "ethers";
import { NotaHashError } from "../errors.js";

/**
 * Computes the resource ID for a given resource type, chain ID, and identifier.
 * Matches `NotareumNotaRegistry._computeResourceId` exactly.
 *
 * @param resourceType - Numeric resource type (0-5).
 * @param chainId - Chain ID as a number or bigint.
 * @param identifier - Resource identifier string (UTF-8 encoded as bytes).
 * @returns bytes32 hex string (0x-prefixed).
 * @throws NotaHashError on invalid inputs.
 */
export function computeResourceIdHash(
  resourceType: number,
  chainId: number | bigint,
  identifier: string
): string {
  if (!Number.isInteger(resourceType) || resourceType < 0 || resourceType > 5) {
    throw new NotaHashError(
      `Invalid resourceType: ${resourceType}. Must be integer 0-5.`
    );
  }
  if (identifier.length === 0) {
    throw new NotaHashError("identifier must be a non-empty string.");
  }

  // uint8: 1 byte for the resource type
  const typeBytes = new Uint8Array([resourceType]);

  // uint256: 32 bytes big-endian for chainId
  const chainIdBig = BigInt(chainId);
  if (chainIdBig < 0n) {
    throw new NotaHashError("chainId must be non-negative.");
  }
  const chainIdRaw = chainIdBig.toString(16).replace(/^0x/, "");
  const chainIdHexPadded = chainIdRaw.padStart(64, "0");
  const chainIdBytes = new Uint8Array(
    (chainIdHexPadded.match(/.{2}/g) as string[]).map((b) => parseInt(b, 16))
  );

  // bytes: UTF-8 encoding of identifier (no length prefix -- matches encodePacked)
  const identifierBytes = new TextEncoder().encode(identifier);

  // abi.encodePacked concatenation
  const packed = concat([typeBytes, chainIdBytes, identifierBytes]);

  return keccak256(packed);
}
