/**
 * SDK-specific types for @notareum/sdk.
 */

import type { Provider, Signer } from "ethers";

/** Deployed contract addresses for the Notareum Protocol. */
export interface ContractAddresses {
  accessManager: string;
  notaToken: string;
  veNota: string;
  validatorStaking: string;
  notaRegistry: string;
  verificationEngine: string;
  slashingManager: string;
  feeManager: string;
}

/** Configuration for NotareumClient. */
export interface ClientConfig {
  /** ethers v6 Provider for read-only operations. */
  provider: Provider;
  /** ethers v6 Signer for write operations (optional). */
  signer?: Signer;
  /** Deployed contract addresses. */
  contracts: ContractAddresses;
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

/** Options for creating a .nota file. */
export interface CreateNotaOptions {
  type: string;
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
