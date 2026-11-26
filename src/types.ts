/**
 * SDK-specific types for @notareum/sdk.
 */

import type { Provider, Signer } from "ethers";
import type {
  NotaControlProof,
  NotaFile,
  NotaStatus,
  RegistryDeployment,
  VerificationLevel,
} from "./core/index.js";

/** Deployed contract addresses for the Notareum Protocol. */
export interface ContractAddresses {
  accessManager: string;
  notaToken: string;
  veNota: string;
  validatorStaking: string;
  notaRegistry: string;
  /**
   * The Conformance Gate. Optional: when omitted the SDK asks the registry
   * (`conformanceGate()`), which is also what stays correct after governance
   * replaces the gate.
   */
  conformanceGate?: string;
  verificationEngine: string;
  slashingManager: string;
  feeManager: string;
}

/** Configuration for the `Notareum()` factory. */
export interface ClientConfig {
  /** ethers v6 Provider for read-only operations. */
  provider: Provider;
  /** ethers v6 Signer for write operations (optional). */
  signer?: Signer;
  /** Deployed contract addresses. */
  contracts: ContractAddresses;
  /**
   * Confirmations to wait for before a mint is treated as final and its
   * `.nota` file is written. Default 1. Raise it on chains where finality is
   * probabilistic: a receipt that is reorganized away points at nothing.
   */
  confirmations?: number;
  /** Milliseconds between checks while a mint is waiting to confirm. Default 1000. */
  pollingInterval?: number;
  /**
   * Further registry deployments this reader trusts, besides the configured
   * one. A file minted on any other registry is refused (trust rule 4).
   */
  trustedRegistries?: readonly RegistryDeployment[];
}

/** Result of a write transaction. */
export interface TransactionResult {
  /** Transaction hash. */
  hash: string;
  /** Wait for the transaction to be mined. */
  wait(): Promise<TransactionReceipt>;
}

/** Simplified transaction receipt. */
export interface TransactionReceipt {
  hash: string;
  blockNumber: number;
  status: number;
}

/**
 * What an issuer supplies to create a `.nota` file. The flat spelling of
 * core's `NotaDraftInput`; both are accepted by `NotaFileClient.compose()`.
 */
export interface CreateNotaOptions {
  /** Resource type name, e.g. `"address"`. */
  type: string;
  /** Canonical chain name, lowercase: `"ethereum"`, `"bitcoin"`, `"solana"`. */
  chainName: string;
  /** EIP-155 chain ID of the resource's chain. 0 for chains without one. */
  chainId: number;
  /** `"mainnet"` (default), `"testnet"` or `"devnet"`. */
  network?: string;
  identifier: string;
  name?: string;
  /** Alias to register with the mint, e.g. `"alice.nota"`. Costs `aliasFee` when newly bound. */
  alias?: string;
  description?: string;
  /** The account that signs and owns the record. Defaults to the configured signer. */
  issuer?: string;
  issuerName?: string;
  issuerEntityType?: "" | "individual" | "organization";
  /** Type-specific metadata. Everything in it is published on-chain permanently. */
  metadata?: Record<string, unknown> | null;
  /** `notaId` of the file this one replaces. Defaults to the issuer's current file for the resource. */
  supersedes?: string;
  /** Unix seconds. Defaults to the registry chain's latest block time. */
  issuedAt?: number;
  /** Unix seconds. Defaults to 0, no expiry. */
  expiresAt?: number;
}

// ---------------------------------------------------------------------------
// Registry records (NotareumNotaRegistry, v1.1)
// ---------------------------------------------------------------------------

/** `NotaRecord`: the registry's record of one minted file. */
export interface NotaRecord {
  notaId: string;
  /** The resource the file describes. */
  resourceId: string;
  /** The account that signed the content and owns the record. Fixed at mint. */
  issuer: string;
  metadataHash: string;
  /** `notaId` of the file this one replaced, or the zero hash. */
  supersedes: string;
  /** `notaId` of the successor, or the zero hash. */
  supersededBy: string;
  status: NotaStatus;
  /** Level of the request that verified the file. Meaningful only while `status` is `VERIFIED`. */
  level: VerificationLevel;
  /** `"self"` when the gate established that the issuer controls the resource, `"claimed"` otherwise. */
  controlProof: NotaControlProof;
  /** Ruleset of the Conformance Gate that admitted the file. */
  ruleset: number;
  /** Unix seconds. */
  mintedAt: number;
  /** Unix seconds. 0 for no expiry. */
  expiresAt: number;
  /** Unix seconds. */
  updatedAt: number;
}

/** `ResourceInfo`: what the registry knows about a resource. */
export interface ResourceRecord {
  resourceId: string;
  /** uint8 resource type ID. */
  resourceType: number;
  /** Type name (`"address"`, ...) when the ID is known locally. */
  typeName: string | undefined;
  chainId: bigint;
  identifier: string;
  /** `notaId` of the VERIFIED, unexpired file that speaks for the resource, or the zero hash. */
  canonical: string;
}

/** The claim an alias is bound to. */
export interface AliasBinding {
  alias: string;
  resourceId: string;
  /** The issuer that holds the alias. */
  owner: string;
  /** The file the alias currently resolves to: the holder's head, or the zero hash. */
  notaId: string;
}

/** Outcome of the gate's `check()` preflight. */
export interface PreflightResult {
  /** True when every rule passed, the signature included. */
  ok: boolean;
  /**
   * True when every rule except the signature rule (G9) passed. An unsigned
   * preflight with `readyToSign` is the cue to ask the issuer to sign.
   */
  readyToSign: boolean;
  /** Number of the rule that failed (1 for G1 through 13 for G13), or `null`. */
  rule: number | null;
  /** `"G8"` and so on, or `null`. */
  ruleId: string | null;
  /** What the failed rule requires, or `null`. */
  message: string | null;
  /** `notaId` of the content under this registry's domain. */
  notaId: string;
  resourceId: string;
  /** What the gate recorded about control of the resource. Known only when `ok`. */
  controlProof: NotaControlProof | null;
}

/** Fees the registry collects from the account that submits a mint. */
export interface MintFees {
  /** Charged on every mint. 0 initially. */
  mintFee: bigint;
  /** Charged when the mint binds a new alias; 0 otherwise. */
  aliasFee: bigint;
  /** NOTA the submitter must hold and have approved to the registry. */
  total: bigint;
}

/** A finished mint. */
export interface MintResult {
  notaId: string;
  resourceId: string;
  transactionHash: string;
  blockNumber: number;
  /** Revision 0 of the `.nota` container. Save it with the `.nota` extension. */
  file: Uint8Array;
  /** The file as read back by the strict reader. */
  nota: NotaFile;
  /** A file name to offer: the alias when there is one, otherwise the short `notaId`. */
  fileName: string;
}

/** A `NotaMinted` event, decoded without validating its content. */
export interface MintedNota {
  notaId: string;
  resourceId: string;
  issuer: string;
  ruleset: number;
  controlProof: NotaControlProof;
  type: string;
  chain: { name: string; chainId: bigint; network: string };
  identifier: string;
  name: string;
  alias: string;
  description: string;
  issuerName: string;
  supersedes: string;
  issuedAt: number;
  expiresAt: number;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
}
