/**
 * @notareum/core - Public API
 *
 * The reference implementation of the Notareum Protocol v1.1 `.nota` format
 * (protocol/v1.1/01-nota-format.md), plus the protocol's registry,
 * verification and staking types.
 */

// Constants and errors
export * from "./constants.js";
export * from "./errors.js";

// v1.1 .nota files: readNota, writeNota, appendAnnex, reconstructFromMintEvent,
// content types, Content Safety Rules, conformance validator, payload builders
export * from "./nota/index.js";

// The binary container: strict reader, low-level encoders, CRC-32
export * from "./container/index.js";

// Canonical JSON (RFC 8785) and strict UTF-8
export * from "./json/index.js";

// Crypto: EIP-712 notaId and signing, resource ID hash
export * from "./crypto/index.js";

// Legacy v1.0 JSON documents, kept for importing old documents as drafts.
// `parseLegacyNota` is the v1.0 JSON parser; the rest of the v1.0 API is under `legacy`.
export * as legacy from "./legacy/index.js";
export { parseNota as parseLegacyNota } from "./legacy/parser.js";
export { importLegacyNota, isLegacyNotaDocument } from "./legacy/import.js";
export type { LegacyImport, LegacyImportOptions } from "./legacy/import.js";
export type { NotaFile as LegacyNotaFile } from "./legacy/types.js";

// Registry
export type { ResourceInfo } from "./registry/types.js";
export { computeResourceId } from "./registry/resource-id.js";

// Verification (VerificationLevel is exported with the nota types)
export { AttestationResult, QUORUM_CONFIGS } from "./verification/types.js";
export type { QuorumConfig } from "./verification/types.js";
export {
  getQuorumConfig,
  isQuorumReached,
  resolveQuorum,
  minApprovalsToPass,
} from "./verification/quorum.js";

// Staking
export * from "./staking/index.js";
