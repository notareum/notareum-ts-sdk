/**
 * Notareum SDK -- unified entry point.
 *
 * @example
 * ```typescript
 * import { Notareum } from "@notareum/sdk";
 *
 * const ntm = Notareum({
 *   provider,
 *   signer,
 *   contracts: {
 *     notaToken: "0x...",
 *     veNota: "0x...",
 *     validatorStaking: "0x...",
 *     notaRegistry: "0x...",
 *     verificationEngine: "0x...",
 *     slashingManager: "0x...",
 *     feeManager: "0x...",
 *     accessManager: "0x...",
 *   }
 * });
 *
 * // .nota file operations
 * const nota = ntm.nota.create({ type: "address", chainId: 1, chainName: "ethereum", identifier: "0x..." });
 * const signed = await nota.sign(signer);
 * console.log(signed.serialize());
 *
 * // On-chain registry
 * await ntm.registry.registerResource(0, 1n, "0x...", "0x" + "00".repeat(32));
 *
 * // Staking
 * await ntm.staking.stake(10_000n * 10n ** 18n);
 * ```
 *
 * @license BUSL-1.1
 * @author Notareum Labs
 */

import { RegistryClient } from "./clients/registry.js";
import { VerificationClient } from "./clients/verification.js";
import { StakingClient } from "./clients/staking.js";
import { GovernanceClient } from "./clients/governance.js";
import { FeeClient } from "./clients/fee.js";
import { NotaFileClient } from "./clients/nota-file.js";
import type { ClientConfig } from "./types.js";

/** The unified Notareum SDK instance. */
export interface NotareumInstance {
  /** .nota file operations (create, sign, parse, validate, serialize). */
  readonly nota: NotaFileClient;
  /** On-chain resource registry (register, resolve, revoke, resource types). */
  readonly registry: RegistryClient;
  /** Verification requests and attestations. */
  readonly verification: VerificationClient;
  /** Validator staking (stake, unstake, tier info). */
  readonly staking: StakingClient;
  /** veNOTA governance (lock, unlock, voting power). */
  readonly governance: GovernanceClient;
  /** Protocol fee queries and configuration. */
  readonly fee: FeeClient;
}

/**
 * Create a Notareum SDK instance.
 *
 * @param config - Provider, optional Signer, and deployed contract addresses.
 * @returns A NotareumInstance with all sub-clients mounted.
 */
export function Notareum(config: ClientConfig): NotareumInstance {
  const { provider, signer, contracts } = config;

  return {
    nota: new NotaFileClient(),
    registry: new RegistryClient(contracts.notaRegistry, provider, signer),
    verification: new VerificationClient(contracts.verificationEngine, provider, signer),
    staking: new StakingClient(contracts.validatorStaking, provider, signer),
    governance: new GovernanceClient(contracts.veNota, provider, signer),
    fee: new FeeClient(contracts.feeManager, provider, signer),
  };
}
