/**
 * @notareum/sdk -- TypeScript SDK for the Notareum Protocol, v1.1.
 *
 * @example
 * ```typescript
 * import { Notareum } from "@notareum/sdk";
 *
 * const ntm = Notareum({ provider, signer, contracts });
 * const minted = await ntm.nota.create({ type: "address", chainName: "ethereum", chainId: 1, identifier });
 * const { standing } = await ntm.nota.verify(minted.file);
 * await ntm.verification.requestVerification(minted.notaId, VerificationLevel.BASIC);
 * ```
 *
 * @license MIT
 * @author Notareum Labs
 */

// Main factory
export { Notareum } from "./client.js";
export type { NotareumInstance } from "./client.js";

// Config and record types
export type {
  ClientConfig,
  ContractAddresses,
  CreateNotaOptions,
  TransactionResult,
  TransactionReceipt,
  NotaRecord,
  ResourceRecord,
  AliasBinding,
  PreflightResult,
  MintFees,
  MintResult,
  MintedNota,
} from "./types.js";

// Sub-clients (for direct instantiation if needed)
export { RegistryClient } from "./clients/registry.js";
export type { RegistryClientOptions, MintOptions, LogRange } from "./clients/registry.js";
export { VerificationClient } from "./clients/verification.js";
export type { VerificationRequest, AttestationCounts } from "./clients/verification.js";
export { StakingClient } from "./clients/staking.js";
export type { ValidatorInfo, UnbondingRequest } from "./clients/staking.js";
export { GovernanceClient } from "./clients/governance.js";
export type { VeNOTALock } from "./clients/governance.js";
export { FeeClient, FeeType } from "./clients/fee.js";
export type { FeeConfig } from "./clients/fee.js";
export { NotaFileClient } from "./clients/nota-file.js";
export type { NotaFileClientOptions, NotaVerification } from "./clients/nota-file.js";

// The mint flow without a provider: for wagmi, viem, relayers
export {
  GATE_RULES,
  describeGateRule,
  toNotaStruct,
  mintArguments,
  notaTypedData,
  signatureFromWallet,
  NOTA_MINTED_TOPIC,
  findNotaMintedLog,
  decodeNotaMintedLog,
  summarizeNotaMintedLog,
  notaFileFromMintLog,
  suggestNotaFileName,
} from "./mint.js";
export type { NotaStruct, NotaTypedData, MintLog, MintContext } from "./mint.js";

// Reader display states
export { deriveNotaStanding } from "./standing.js";
export type { NotaDisplayState, NotaStanding, RegistryEvidence } from "./standing.js";

// Error classes
export {
  SignerRequiredError,
  ContractCallError,
  ConformanceFailedError,
  ConfigurationError,
  ResourceNotFoundError,
  NotaNotFoundError,
  UntrustedRegistryError,
} from "./errors.js";
export {
  NotaParseError,
  NotaValidationError,
  NotaConformanceError,
  NotaContainerError,
  NotaSignatureError,
  CanonicalJsonError,
} from "./core/index.js";
export type { NotaContainerErrorCode } from "./core/index.js";

// The v1.1 .nota format (vendored @notareum/core)
export {
  // files
  readNota,
  writeNota,
  appendAnnex,
  collapseAnnexes,
  extractMintedBody,
  reconstructFromMintEvent,
  hasNotaMagic,
  // drafts and conformance
  composeNotaDraft,
  checkContent,
  validateContent,
  isConformingContent,
  checkIdentifier,
  checkAlias,
  checkDisplayString,
  computeMetadataHash,
  encodeMetadata,
  // identifiers and signing
  computeNotaId,
  computeNotaResourceId,
  signNotaContent,
  verifyNotaSignature,
  recoverNotaSigner,
  notaDomain,
  NOTA_EIP712_TYPES,
  NOTA_EIP712_PRIMARY_TYPE,
  // payloads
  buildSignature,
  buildReceipt,
  buildStatusSnapshot,
  deriveControlProof,
  // legacy v1.0 documents
  importLegacyNota,
  isLegacyNotaDocument,
  parseLegacyNota,
  legacy,
  // enums and type registry
  ResourceType,
  NotaStatus,
  NOTA_STATUS_STRINGS,
  VerificationLevel,
  VERIFICATION_LEVEL_STRINGS,
  StakingTier,
  resolveResourceTypeId,
  resolveResourceTypeString,
  isValidResourceType,
  registerResourceType,
  // constants
  NOTA_SCHEMA_VERSION,
  NOTA_MIME_TYPE,
  NOTA_LEGACY_MIME_TYPE,
  NOTA_FILE_EXTENSION,
  NOTA_ZERO_HASH,
  NOTA_MAX_FILE_BYTES,
  NOTA_MAX_METADATA_BYTES,
  NOTA_FIELD_BYTE_LIMITS,
  MINT_WINDOW_SECONDS,
  MAX_CLOCK_SKEW_SECONDS,
} from "./core/index.js";
export type {
  NotaFile,
  NotaDraft,
  NotaDraftInput,
  NotaContent,
  NotaChain,
  NotaResource,
  NotaIssuer,
  NotaSignature,
  NotaSignatureScheme,
  NotaReceipt,
  NotaControlProof,
  NotaStatusSnapshot,
  NotaAnnexObject,
  NotaAnnexInput,
  RegistryDeployment,
  ReadNotaOptions,
  ConformanceIssue,
  LegacyImport,
  LegacyImportOptions,
  LegacyNotaFile,
  NotaTypedDataSigner,
  ResourceTypeString,
  NotaStatusString,
  VerificationLevelString,
} from "./core/index.js";

// ABI re-exports
export * from "./abi/index.js";
