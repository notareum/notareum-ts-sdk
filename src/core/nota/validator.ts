/**
 * .nota file validator.
 *
 * Performs semantic validation on a parsed NotaFile.
 */

import {
  NOTA_SCHEMA_VERSION,
  NOTA_MAX_METADATA_BYTES,
} from "../constants.js";
import { NotaValidationError } from "../errors.js";
import type { NotaFile } from "./types.js";
import {
  isValidResourceType,
} from "./types.js";

const VALID_STATUSES = ["unverified", "pending", "verified", "disputed", "revoked"];
const VALID_LEVELS = ["basic", "enhanced", "institutional"];
const VALID_ALGORITHMS = ["ECDSA", "EdDSA"];
const VALID_CURVES = ["secp256k1", "ed25519"];

/**
 * Validates a .nota file structure and field values.
 *
 * @param nota - The file to validate.
 * @throws NotaValidationError on the first invalid field found.
 */
export function validateNota(nota: NotaFile): void {
  // version
  if (nota.version !== NOTA_SCHEMA_VERSION) {
    throw new NotaValidationError(
      "version",
      `Unsupported version "${nota.version}". Expected "${NOTA_SCHEMA_VERSION}".`
    );
  }

  // type
  if (!isValidResourceType(nota.type)) {
    throw new NotaValidationError(
      "type",
      `Unknown resource type "${nota.type}". Register custom types with registerResourceType().`
    );
  }

  // chain
  if (!nota.chain || typeof nota.chain !== "object") {
    throw new NotaValidationError("chain", "Chain object is required.");
  }
  if (typeof nota.chain.name !== "string" || nota.chain.name.trim() === "") {
    throw new NotaValidationError("chain.name", "Chain name must be a non-empty string.");
  }
  if (typeof nota.chain.chainId !== "number" || !Number.isInteger(nota.chain.chainId) || nota.chain.chainId < 0) {
    throw new NotaValidationError(
      "chain.chainId",
      "chainId must be a non-negative integer."
    );
  }

  // resource
  if (!nota.resource || typeof nota.resource !== "object") {
    throw new NotaValidationError("resource", "Resource object is required.");
  }
  if (typeof nota.resource.identifier !== "string" || nota.resource.identifier.trim() === "") {
    throw new NotaValidationError(
      "resource.identifier",
      "identifier must be a non-empty string."
    );
  }

  // Validate metadata size
  if (nota.resource.metadata !== undefined) {
    const metaStr = JSON.stringify(nota.resource.metadata);
    const metaBytes = Buffer.from(metaStr, "utf8").length;
    if (metaBytes > NOTA_MAX_METADATA_BYTES) {
      throw new NotaValidationError(
        "resource.metadata",
        `Metadata exceeds maximum size of ${NOTA_MAX_METADATA_BYTES} bytes (got ${metaBytes} bytes).`
      );
    }
  }

  // verification (optional)
  if (nota.verification !== undefined) {
    if (!VALID_STATUSES.includes(nota.verification.status)) {
      throw new NotaValidationError(
        "verification.status",
        `Invalid status "${nota.verification.status}". Must be one of: ${VALID_STATUSES.join(", ")}.`
      );
    }
    if (
      nota.verification.level !== undefined &&
      !VALID_LEVELS.includes(nota.verification.level)
    ) {
      throw new NotaValidationError(
        "verification.level",
        `Invalid level "${nota.verification.level}". Must be one of: ${VALID_LEVELS.join(", ")}.`
      );
    }
  }

  // signature
  if (!nota.signature || typeof nota.signature !== "object") {
    throw new NotaValidationError("signature", "Signature object is required.");
  }
  if (!VALID_ALGORITHMS.includes(nota.signature.algorithm)) {
    throw new NotaValidationError(
      "signature.algorithm",
      `Invalid algorithm "${nota.signature.algorithm}". Must be one of: ${VALID_ALGORITHMS.join(", ")}.`
    );
  }
  if (!VALID_CURVES.includes(nota.signature.curve)) {
    throw new NotaValidationError(
      "signature.curve",
      `Invalid curve "${nota.signature.curve}". Must be one of: ${VALID_CURVES.join(", ")}.`
    );
  }
  if (typeof nota.signature.address !== "string" || nota.signature.address.trim() === "") {
    throw new NotaValidationError(
      "signature.address",
      "Signing address must be a non-empty string."
    );
  }
  if (typeof nota.signature.message !== "string" || nota.signature.message.trim() === "") {
    throw new NotaValidationError("signature.message", "Message must be a non-empty string.");
  }
  if (typeof nota.signature.signature !== "string" || nota.signature.signature.trim() === "") {
    throw new NotaValidationError("signature.signature", "Signature must be a non-empty string.");
  }
  if (
    typeof nota.signature.timestamp !== "number" ||
    !Number.isInteger(nota.signature.timestamp) ||
    nota.signature.timestamp <= 0
  ) {
    throw new NotaValidationError(
      "signature.timestamp",
      "Timestamp must be a positive integer (Unix seconds)."
    );
  }
}

/**
 * Returns true if the .nota file is valid; false otherwise.
 * Does not throw.
 */
export function isValidNota(nota: NotaFile): boolean {
  try {
    validateNota(nota);
    return true;
  } catch {
    return false;
  }
}
