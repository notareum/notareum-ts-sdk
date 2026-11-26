/**
 * Legacy v1.0 `.nota` JSON documents.
 *
 * A v1.0 document is a bare JSON object signed with EIP-191 over the resource
 * alone. Under v1.1 it is not a `.nota` file. This module keeps the v1.0
 * parser, validator, builder and signer so that old documents can still be
 * read, and adds `importLegacyNota`, which maps one onto a v1.1 draft.
 *
 * The names below are the v1.0 names. From the package root they are reached
 * through the `legacy` namespace (`legacy.parseNota`) or the
 * `@notareum/core/legacy` entry point, so they cannot be mistaken for the
 * v1.1 API.
 */

export { parseNota, serializeNota } from "./parser.js";
export { buildNota, buildUnsignedNota } from "./builder.js";
export { validateNota, isValidNota } from "./validator.js";
export { buildSigningMessage, signNota, signMessage, personalSignHash } from "./signer.js";
export { recoverSignerAddress, verifySignature, verifyNotaSignature } from "./verifier.js";
export { importLegacyNota, isLegacyNotaDocument } from "./import.js";
export type { LegacyImport, LegacyImportOptions } from "./import.js";
export type {
  NotaFile,
  NotaChain,
  NotaResource,
  NotaVerification,
  NotaSignature,
  NotaIssuer,
  NotaMetadata,
} from "./types.js";
