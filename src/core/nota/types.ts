/**
 * Registry-level types shared by every version of the .nota format: resource
 * types, statuses and verification levels, matching the NotareumNotaRegistry
 * contract enums.
 *
 * The v1.1 content and payload types are in `content.ts`. The v1.0 JSON
 * document types are in `../legacy/types.ts`.
 */

// ---------------------------------------------------------------------------
// Enums (matching contract values exactly)
// ---------------------------------------------------------------------------

/**
 * Well-known resource type constants. Integer values match the uint8 constants
 * in NotareumNotaRegistry. New types may be added via governance without
 * redeploying contracts.
 */
export const ResourceType = {
  ADDRESS: 0,
  TRANSACTION: 1,
  CONTRACT: 2,
  IPFS: 3,
  NFT: 4,
  METADATA: 5,
} as const;

/** A resource type ID (uint8). Well-known values are in ResourceType. */
export type ResourceTypeId = number;

/** String values used in .nota files for the `type` field. */
export type ResourceTypeString = string;

/** Well-known .nota type strings for the initial set of resource types. */
export const WELL_KNOWN_TYPE_STRINGS: readonly string[] = [
  "address",
  "transaction",
  "contract",
  "ipfs",
  "nft",
  "metadata",
];

/**
 * Bidirectional mapping between .nota type strings and uint8 type IDs.
 * Supports governance-added types via registerResourceType().
 */
const _typeStringToId = new Map<string, number>([
  ["address", ResourceType.ADDRESS],
  ["transaction", ResourceType.TRANSACTION],
  ["contract", ResourceType.CONTRACT],
  ["ipfs", ResourceType.IPFS],
  ["nft", ResourceType.NFT],
  ["metadata", ResourceType.METADATA],
]);

const _typeIdToString = new Map<number, string>([
  [ResourceType.ADDRESS, "address"],
  [ResourceType.TRANSACTION, "transaction"],
  [ResourceType.CONTRACT, "contract"],
  [ResourceType.IPFS, "ipfs"],
  [ResourceType.NFT, "nft"],
  [ResourceType.METADATA, "metadata"],
]);

/** Register a custom resource type (for governance-added types). */
export function registerResourceType(typeId: number, typeString: string): void {
  _typeStringToId.set(typeString, typeId);
  _typeIdToString.set(typeId, typeString);
}

/** Resolve a .nota type string to a uint8 type ID. Returns undefined if unknown. */
export function resolveResourceTypeId(typeString: string): number | undefined {
  return _typeStringToId.get(typeString);
}

/** Resolve a uint8 type ID to a .nota type string. Returns undefined if unknown. */
export function resolveResourceTypeString(typeId: number): string | undefined {
  return _typeIdToString.get(typeId);
}

/** Check if a type string is known (well-known or registered). */
export function isValidResourceType(typeString: string): boolean {
  return _typeStringToId.has(typeString);
}

/** Check if a type ID is known (well-known or registered). */
export function isValidResourceTypeId(typeId: number): boolean {
  return _typeIdToString.has(typeId);
}

/**
 * Status of a minted file. Matches `NotareumNotaRegistry.NotaStatus` (v1.1).
 */
export enum NotaStatus {
  /** Minted. Passed the Conformance Gate. Not socially verified. */
  REGISTERED = 0,
  /** A social verification request is open. */
  PENDING = 1,
  /** Socially verified: validator consensus reached. */
  VERIFIED = 2,
  /** A content report is open against the file. */
  DISPUTED = 3,
  /** Revoked by the issuer or by an upheld report. Terminal. */
  REVOKED = 4,
  /** Replaced by a successor from the same issuer. Terminal. */
  SUPERSEDED = 5,
}

/** Status names as they appear in a `STAT` annex object. */
export type NotaStatusString =
  | "registered"
  | "pending"
  | "verified"
  | "disputed"
  | "revoked"
  | "superseded";

/** `NotaStatus` values in enum order, as `STAT` status names. */
export const NOTA_STATUS_STRINGS: readonly NotaStatusString[] = Object.freeze([
  "registered",
  "pending",
  "verified",
  "disputed",
  "revoked",
  "superseded",
]);

/** `VerificationLevel` values in enum order, as `STAT` level names. */
export const VERIFICATION_LEVEL_STRINGS: readonly VerificationLevelString[] = Object.freeze([
  "basic",
  "enhanced",
  "institutional",
]);

/**
 * v1.0 verification status enum (`NotareumNotaRegistry.VerificationStatus`).
 *
 * @deprecated v1.1 renames `UNVERIFIED` to `REGISTERED` and adds `SUPERSEDED`.
 *   Use {@link NotaStatus}.
 */
export enum VerificationStatus {
  UNVERIFIED = 0,
  PENDING = 1,
  VERIFIED = 2,
  DISPUTED = 3,
  REVOKED = 4,
}

export type VerificationStatusString =
  | "unverified"
  | "pending"
  | "verified"
  | "disputed"
  | "revoked";

/**
 * Verification level enum. Matches NotareumNotaRegistry.VerificationLevel.
 */
export enum VerificationLevel {
  BASIC = 0,
  ENHANCED = 1,
  INSTITUTIONAL = 2,
}

export type VerificationLevelString = "basic" | "enhanced" | "institutional";
