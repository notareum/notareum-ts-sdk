/**
 * v1.1 `.nota` types: the content layer and the JSON payloads of the other
 * objects (protocol/v1.1/01-nota-format.md).
 */

import type { Container } from "../container/types.js";
import type { JsonObject } from "../json/canonical.js";
import type { NotaStatusString, VerificationLevelString } from "./types.js";

// ---------------------------------------------------------------------------
// Content layer (CONT)
// ---------------------------------------------------------------------------

/** `chain` member of the content layer. */
export interface NotaChain {
  /** Canonical chain name, lowercase: `[a-z0-9-]{1,32}`. */
  name: string;
  /** EIP-155 chain ID of the resource's chain. 0 for chains without one. */
  chainId: number;
  /** `"mainnet"`, `"testnet"` or `"devnet"`. */
  network: string;
}

/** `resource` member of the content layer. */
export interface NotaResource {
  /** The resource identifier. Its grammar depends on `type` and `chain.chainId`. */
  identifier: string;
  /** Human-readable name. May be empty. */
  name: string;
  /** Alias to register with the mint, e.g. `"alice.nota"`. May be empty. */
  alias: string;
  /** Free-form description. May be empty. */
  description: string;
}

/** `issuer.entityType` values. */
export type NotaEntityType = "" | "individual" | "organization";

/** `issuer` member of the content layer. */
export interface NotaIssuer {
  /** EIP-55 address of the account that signs the content and owns the registry record. */
  account: string;
  /** Human-readable issuer name. May be empty. */
  name: string;
  /** `""`, `"individual"` or `"organization"`. */
  entityType: string;
}

/**
 * The content layer: the complete, immutable statement the issuer signed and
 * the registry accepted. Every member is required; a member that does not
 * apply holds its empty value. The object is exactly the EIP-712 `message`.
 */
export interface NotaContent {
  /** Content schema version. `"1.1"`. */
  version: string;
  /** Resource type name registered in the registry. */
  type: string;
  chain: NotaChain;
  resource: NotaResource;
  issuer: NotaIssuer;
  /** keccak256 of the `META` payload, lowercase hex. The zero hash when there is no metadata. */
  metadataHash: string;
  /** `notaId` of the file this one replaces, or the zero hash. */
  supersedes: string;
  /** Unix time in seconds at which the issuer signed. */
  issuedAt: number;
  /** Unix time in seconds after which the file is no longer valid. 0 for no expiry. */
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Signature (SIGN)
// ---------------------------------------------------------------------------

/** How the issuer signed. */
export type NotaSignatureScheme = "eip712-secp256k1" | "erc1271";

/** The `SIGN` payload. */
export interface NotaSignature {
  /** `"eip712-secp256k1"` for an externally owned account, `"erc1271"` for a contract account. */
  scheme: NotaSignatureScheme;
  /**
   * For `eip712-secp256k1`: the 65-byte ECDSA signature (r, s, v) over `notaId`.
   * For `erc1271`: the bytes passed to `isValidSignature(notaId, signature)`.
   * Lowercase hex.
   */
  signature: string;
  /** Equals `issuer.account`. */
  signer: string;
}

// ---------------------------------------------------------------------------
// Registry receipt (RCPT)
// ---------------------------------------------------------------------------

/** A deployment of `NotareumNotaRegistry`. */
export interface RegistryDeployment {
  /** Chain ID of the chain the registry is deployed on. */
  chainId: number;
  /** EIP-55 address of the registry contract. */
  address: string;
}

/** What the gate established about the issuer's control of the resource. */
export type NotaControlProof = "self" | "claimed";

/** The `RCPT` payload: a locator for the mint. It proves nothing by itself. */
export interface NotaReceipt {
  registry: RegistryDeployment;
  notaId: string;
  resourceId: string;
  /** Version of the Conformance Gate ruleset the content passed. */
  ruleset: number;
  controlProof: NotaControlProof;
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
  /** Timestamp of the block that included the mint. */
  mintedAt: number;
}

// ---------------------------------------------------------------------------
// Annex objects (STAT)
// ---------------------------------------------------------------------------

/**
 * The `STAT` payload: the registry status of the file as of a block. A cached
 * snapshot, not a proof. Status `"verified"` means socially verified: a
 * quorum of staked validators attested to the file.
 */
export interface NotaStatusSnapshot {
  asOfBlock: number;
  asOfTime: number;
  status: NotaStatusString;
  /** Level of the most recent resolved social verification request, or `""` when there is none. */
  level: VerificationLevelString | "";
  /** 0 when there is no resolved request. */
  requestId: number;
  approvals: number;
  rejections: number;
  /** Transaction that resolved the request, or `""` when there is none. */
  transactionHash: string;
}

/** A recognized annex object, with the revision that carries it. `STAT` is the only kind v1.1 defines. */
export interface NotaAnnexObject {
  type: "STAT";
  number: number;
  revision: number;
  snapshot: NotaStatusSnapshot;
}

/** An annex object to append. */
export interface NotaAnnexInput {
  type: "STAT";
  snapshot: NotaStatusSnapshot;
}

// ---------------------------------------------------------------------------
// A file that has been read
// ---------------------------------------------------------------------------

/**
 * A `.nota` file that passed the offline trust rules: it parsed strictly, its
 * `notaId`, `metadataHash` and `resourceId` recompute to the values in the
 * receipt, and its signature was checked as far as it can be offline.
 *
 * This is the **Unconfirmed** state. It does not show that the file was
 * minted: a receipt can be fabricated. Only `getNota(notaId)` on a pinned
 * registry deployment does. A reader MUST NOT present the file as registered
 * or socially verified on the strength of this object, whatever its annexes
 * say.
 */
export interface NotaFile {
  /** Always `"unconfirmed"`: the strongest state an offline read can establish. */
  state: "unconfirmed";
  /** `versionMinor` of the container header. */
  versionMinor: number;
  content: NotaContent;
  /** The parsed `META` payload, or `null` when the file has no metadata. */
  metadata: JsonObject | null;
  /** The `META` payload bytes, or `null`. */
  metadataBytes: Uint8Array | null;
  signature: NotaSignature;
  receipt: NotaReceipt;
  /** Recomputed from the content under the receipt's registry domain. Equals `receipt.notaId`. */
  notaId: string;
  /** Recomputed from the content. Equals `receipt.resourceId`. */
  resourceId: string;
  /**
   * True when the signer was recovered from the signature and equals
   * `issuer.account`. False for `erc1271`, which cannot be checked offline.
   */
  signatureVerified: boolean;
  /** True when the receipt's registry matched the caller's pinned list. False when no list was given. */
  registryPinned: boolean;
  /** Recognized annex objects in file order. */
  annexObjects: NotaAnnexObject[];
  /** The `STAT` snapshot with the highest `asOfBlock`, or `null`. Stale by nature: label it with its age. */
  statusSnapshot: NotaStatusSnapshot | null;
  /** keccak256 of the whole file, lowercase hex. */
  fileHash: string;
  /** The container structure the file was read from. */
  container: Container;
}

/** Content and metadata that have not been minted. A draft is not a `.nota` file. */
export interface NotaDraft {
  content: NotaContent;
  /** Canonical metadata bytes, or `null` when there is no metadata. */
  metadata: Uint8Array | null;
}
