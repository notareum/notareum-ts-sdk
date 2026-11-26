/**
 * The v1.1 `.nota` format: content layer, payloads, validation, and whole-file
 * reading and writing. The legacy v1.0 JSON document API is in `../legacy`.
 */

// Reading and writing files
export {
  readNota,
  writeNota,
  appendAnnex,
  collapseAnnexes,
  extractMintedBody,
  reconstructFromMintEvent,
  contentFromMintedStruct,
  NOTA_MINTED_EVENT_ABI,
} from "./file.js";
export type {
  ReadNotaOptions,
  WriteNotaInput,
  NotaMintedEvent,
  MintedNotaStruct,
  MintLocation,
} from "./file.js";

// Types
export type {
  NotaContent,
  NotaChain,
  NotaResource,
  NotaIssuer,
  NotaEntityType,
  NotaSignature,
  NotaSignatureScheme,
  NotaReceipt,
  NotaControlProof,
  RegistryDeployment,
  NotaStatusSnapshot,
  NotaAnnexObject,
  NotaAnnexInput,
  NotaFile,
  NotaDraft,
} from "./content.js";

// Content Safety Rules T1-T6
export {
  classifyCodePoint,
  findTextSafetyViolation,
  findUtf8SafetyViolation,
  isSafeText,
  formatCodePoint,
  SAFETY_RULE_NAMES,
} from "./safety.js";
export type { SafetyRule, SafetyViolation } from "./safety.js";

// Conformance Gate rules that can be decided locally
export {
  checkContent,
  validateContent,
  isConformingContent,
  checkIdentifier,
  checkAlias,
  checkDisplayString,
  isEip55Address,
  isBytes32Hex,
} from "./conformance.js";
export type { ConformanceIssue, ContentCheckOptions } from "./conformance.js";

// Metadata
export {
  computeMetadataHash,
  encodeMetadata,
  validateMetadataBytes,
  scanMetadataStructure,
} from "./metadata.js";

// SIGN, RCPT, STAT payloads
export {
  buildSignature,
  validateSignature,
  buildReceipt,
  validateReceipt,
  validateRegistry,
  buildStatusSnapshot,
  validateStatusSnapshot,
  computeNotaResourceId,
  deriveControlProof,
  controlProofName,
} from "./payloads.js";
export type {
  SignatureInput,
  ReceiptInput,
  StatusSnapshotInput,
} from "./payloads.js";

// Drafts
export { composeNotaDraft, normalizeNfc } from "./draft.js";
export type { NotaDraftInput } from "./draft.js";

// Registry-level types shared by every format version
export type {
  ResourceTypeId,
  ResourceTypeString,
  NotaStatusString,
  VerificationStatusString,
  VerificationLevelString,
} from "./types.js";
export {
  ResourceType,
  NotaStatus,
  NOTA_STATUS_STRINGS,
  VerificationStatus,
  VerificationLevel,
  VERIFICATION_LEVEL_STRINGS,
  registerResourceType,
  resolveResourceTypeId,
  resolveResourceTypeString,
  isValidResourceType,
  isValidResourceTypeId,
  WELL_KNOWN_TYPE_STRINGS,
} from "./types.js";
