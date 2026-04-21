/**
 * @notareum/sdk -- TypeScript SDK for the Notareum Protocol.
 *
 * @example
 * ```typescript
 * import { Notareum } from "@notareum/sdk";
 *
 * const ntm = Notareum({ provider, signer, contracts });
 * ntm.nota.create(...);
 * ntm.registry.registerResource(...);
 * ntm.staking.stake(...);
 * ntm.governance.lock(...);
 * ```
 *
 * @license MIT
 * @author Notareum Labs
 */

// Main factory
export { Notareum } from "./client.js";
export type { NotareumInstance } from "./client.js";

// Config types
export type { ClientConfig, ContractAddresses, CreateNotaOptions, TransactionResult, TransactionReceipt } from "./types.js";

// Sub-clients (for direct instantiation if needed)
export { RegistryClient } from "./clients/registry.js";
export { VerificationClient } from "./clients/verification.js";
export { StakingClient, ValidatorTier } from "./clients/staking.js";
export { GovernanceClient } from "./clients/governance.js";
export { FeeClient } from "./clients/fee.js";
export { NotaFileClient, NotaBuilder } from "./clients/nota-file.js";

// Types from sub-clients
export type { ValidatorInfo } from "./clients/staking.js";
export type { VeNOTALock } from "./clients/governance.js";
export type { FeeConfig } from "./clients/fee.js";
export type { VerificationRequest } from "./clients/verification.js";

// Error classes
export {
  SignerRequiredError,
  ContractCallError,
  ConfigurationError,
  ResourceNotFoundError,
} from "./errors.js";

// ABI re-exports
export * from "./abi/index.js";
