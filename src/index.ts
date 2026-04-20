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
 * @license BUSL-1.1
 * @author Notareum Labs
 */

// Main factory
export { Notareum } from "./client.js";
export type { NotareumInstance } from "./client.js";

// Config types
export type { ClientConfig, ContractAddresses, CreateNotaOptions, TransactionResult, TransactionReceipt } from "./types.js";

// Sub-clients (for direct instantiation if needed)
export { RegistryClient } from "./registry.js";
export { VerificationClient } from "./verification.js";
export { StakingClient, ValidatorTier } from "./staking.js";
export { GovernanceClient } from "./governance.js";
export { FeeClient } from "./fee.js";
export { NotaFileClient, NotaBuilder } from "./nota-file.js";

// Types from sub-clients
export type { ValidatorInfo } from "./staking.js";
export type { VeNOTALock } from "./governance.js";
export type { FeeConfig } from "./fee.js";
export type { VerificationRequest } from "./verification.js";

// Error classes
export {
  SignerRequiredError,
  ContractCallError,
  ConfigurationError,
  ResourceNotFoundError,
} from "./errors.js";

// ABI re-exports
export * from "./abi/index.js";
