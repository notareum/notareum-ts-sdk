/**
 * Types for the legacy v1.0 `.nota` JSON document.
 *
 * A v1.0 document is not a `.nota` file under v1.1. It can only be imported
 * as a draft: see `importLegacyNota`.
 */

import type {
  ResourceTypeString,
  VerificationLevelString,
  VerificationStatusString,
} from "../nota/types.js";

export type {
  ResourceTypeString,
  VerificationLevelString,
  VerificationStatusString,
} from "../nota/types.js";

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
