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
 * // Create a .nota file by minting it
 * const minted = await ntm.nota.create({
 *   type: "address",
 *   chainName: "ethereum",
 *   chainId: 1,
 *   identifier: await signer.getAddress(),
 *   name: "Treasury",
 * });
 * await writeFile(minted.fileName, minted.file);
 *
 * // Read one back and establish what may be said about it
 * const { file, standing } = await ntm.nota.verify(bytes);
 * console.log(standing.label); // "Registered. Not socially verified."
 *
 * // Staking
 * await ntm.staking.stake(10_000n * 10n ** 18n);
 * ```
 *
 * @license MIT
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
  /** `.nota` files: compose, sign, mint, read, verify, import legacy documents. */
  readonly nota: NotaFileClient;
  /** The on-chain registry of minted files: mint, records, aliases, revocation. */
  readonly registry: RegistryClient;
  /** Social verification: requests and validator attestations, by `notaId`. */
  readonly verification: VerificationClient;
  /** Validator staking (stake, unbond, rewards, tier info). */
  readonly staking: StakingClient;
  /** veNOTA governance (locks as NFTs, voting power). */
  readonly governance: GovernanceClient;
  /** Fee distribution (burn and treasury split, validator rewards). */
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

  const registry = new RegistryClient(contracts.notaRegistry, provider, signer, {
    conformanceGate: contracts.conformanceGate,
    confirmations: config.confirmations,
    pollingInterval: config.pollingInterval,
  });

  return {
    nota: new NotaFileClient(registry, { signer, trustedRegistries: config.trustedRegistries }),
    registry,
    verification: new VerificationClient(contracts.verificationEngine, provider, signer),
    staking: new StakingClient(contracts.validatorStaking, provider, signer),
    governance: new GovernanceClient(contracts.veNota, provider, signer),
    fee: new FeeClient(contracts.feeManager, provider, signer),
  };
}
