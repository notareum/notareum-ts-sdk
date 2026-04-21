/**
 * TypeScript types for the .nota file format.
 *
 * Based on the Notareum Protocol whitepaper Section 2 and
 * the NotareumNotaRegistry contract enums.
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
 * Verification status enum. Matches NotareumNotaRegistry.VerificationStatus.
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

// ---------------------------------------------------------------------------
// .nota file structure
// ---------------------------------------------------------------------------

/** The `chain` section of a .nota file. */
export interface NotaChain {
  /** Canonical chain name (e.g., "ethereum", "polygon", "bitcoin"). */
  name: string;
  /**
   * EIP-155 chain ID. Use 0 for non-EVM chains where chain IDs do not apply.
   */
  chainId: number;
  /** Network qualifier: "mainnet", "testnet", "devnet". Defaults to "mainnet". */
  network?: string;
}

/** The `resource` section of a .nota file. */
export interface NotaResource {
  /** Canonical resource identifier (address, tx hash, CID, etc.). */
  identifier: string;
  /** Human-readable name for the resource. */
  name?: string;
  /** Optional alias (e.g., "alice.nota"). */
  alias?: string;
  /** Optional free-form description. */
  description?: string;
  /** Type-specific metadata. */
  metadata?: Record<string, unknown>;
}

/** The `verification` section of a .nota file. */
export interface NotaVerification {
  /** Current verification status. */
  status: VerificationStatusString;
  /** Verification level achieved. */
  level?: VerificationLevelString;
  /** Addresses of validators that submitted approving attestations. */
  validators?: string[];
  /** bytes32 hex: hash of off-chain proof material. */
  proofHash?: string;
}

/** The `signature` section of a .nota file. */
export interface NotaSignature {
  /** Signing algorithm: "ECDSA" for EVM chains, "EdDSA" for ed25519-based chains. */
  algorithm: "ECDSA" | "EdDSA";
  /** Elliptic curve: "secp256k1" or "ed25519". */
  curve: "secp256k1" | "ed25519";
  /** The signing address (checksummed hex for EVM). */
  address: string;
  /** The canonical message that was signed. */
  message: string;
  /** The cryptographic signature (0x-prefixed 65-byte hex for EVM ECDSA). */
  signature: string;
  /** Unix timestamp (seconds) at signing time. */
  timestamp: number;
}

/** The `issuer` section of a .nota file. */
export interface NotaIssuer {
  /** On-chain address of the issuing entity. */
  address: string;
  /** Human-readable entity name. */
  name?: string;
  /** Whether the issuer is itself a verified entity in the registry. */
  verified?: boolean;
  /** Entity classification. */
  entityType?: "individual" | "organization";
}

/** The complete .nota file structure. */
export interface NotaFile {
  /** Schema version. MUST be "1.0" for this specification. */
  version: string;
  /** Resource type string. */
  type: ResourceTypeString;
  /** Chain context. */
  chain: NotaChain;
  /** The resource. */
  resource: NotaResource;
  /** Verification state. */
  verification?: NotaVerification;
  /** Cryptographic signature. */
  signature: NotaSignature;
  /** Issuer metadata. */
  issuer?: NotaIssuer;
}

/** Metadata for building a .nota file. */
export interface NotaMetadata {
  type: ResourceTypeString;
  chainName: string;
  chainId: number;
  network?: string;
  identifier: string;
  name?: string;
  alias?: string;
  description?: string;
  resourceMetadata?: Record<string, unknown>;
  issuerName?: string;
  issuerEntityType?: "individual" | "organization";
}
