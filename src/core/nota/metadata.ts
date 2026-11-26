/**
 * The `META` payload and `metadataHash`
 * (protocol/v1.1/01-nota-format.md "Metadata", 10-conformance-gate.md G7).
 */

import { keccak256 } from "ethers";
import { NOTA_MAX_JSON_DEPTH, NOTA_MAX_METADATA_BYTES, NOTA_ZERO_HASH } from "../constants.js";
import { CanonicalJsonError, NotaConformanceError } from "../errors.js";
import { canonicalBytes, parseCanonicalJson } from "../json/canonical.js";
import type { JsonObject } from "../json/canonical.js";
import { isPlainObject } from "./conformance.js";
import { findUtf8SafetyViolation } from "./safety.js";

/**
 * `metadataHash` for a `META` payload: keccak256 of the bytes, or the zero
 * hash when there is no metadata (`null`, `undefined`, or zero bytes).
 */
export function computeMetadataHash(metadata: Uint8Array | null | undefined): string {
  if (metadata === null || metadata === undefined || metadata.length === 0) return NOTA_ZERO_HASH;
  return keccak256(metadata);
}

/**
 * The gate's one-pass structural scan of metadata bytes (rule G7). Returns a
 * description of the failure, or `null` if the bytes pass.
 *
 * The scan requires that the first byte is `{` and the last is `}`; that
 * braces and brackets outside strings are balanced and never nest deeper than
 * 8; that every string is terminated; and that inside strings a backslash is
 * followed only by `"` or `\`.
 */
export function scanMetadataStructure(bytes: Uint8Array): string | null {
  const n = bytes.length;
  if (n < 2 || bytes[0] !== 0x7b || bytes[n - 1] !== 0x7d) {
    return "the first byte must be '{' and the last '}'";
  }
  const open: number[] = [];
  let inString = false;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (inString) {
      if (b === 0x5c) {
        const next = i + 1 < n ? bytes[i + 1] : -1;
        if (next !== 0x22 && next !== 0x5c) {
          return `a backslash at byte ${i} is followed by something other than '"' or '\\'`;
        }
        i++;
      } else if (b === 0x22) {
        inString = false;
      }
    } else if (b === 0x22) {
      inString = true;
    } else if (b === 0x7b || b === 0x5b) {
      open.push(b);
      if (open.length > NOTA_MAX_JSON_DEPTH) {
        return `braces and brackets nest deeper than ${NOTA_MAX_JSON_DEPTH}`;
      }
    } else if (b === 0x7d || b === 0x5d) {
      const opener = open.pop();
      if (opener === undefined || opener !== (b === 0x7d ? 0x7b : 0x5b)) {
        return `unbalanced '${String.fromCharCode(b)}' at byte ${i}`;
      }
    }
  }
  if (inString) return "unterminated string";
  if (open.length !== 0) return "unbalanced braces or brackets";
  return null;
}

/**
 * Validates `META` payload bytes and returns the parsed object.
 *
 * Checks the 32,768-byte limit (G2), Content Safety Rules T1 through T6 on
 * the raw bytes (G3), the gate's structural scan (G7), and that the bytes are
 * a canonical JSON object (the container's requirement).
 *
 * @throws NotaConformanceError naming the rule; `field` is `"metadata"`.
 */
export function validateMetadataBytes(bytes: Uint8Array): JsonObject {
  if (bytes.length > NOTA_MAX_METADATA_BYTES) {
    throw new NotaConformanceError(
      "G2",
      "metadata",
      `is ${bytes.length} bytes; the limit is ${NOTA_MAX_METADATA_BYTES}`
    );
  }
  const violation = findUtf8SafetyViolation(bytes);
  if (violation !== null) {
    throw new NotaConformanceError(violation.rule, "metadata", violation.message);
  }
  const structure = scanMetadataStructure(bytes);
  if (structure !== null) {
    throw new NotaConformanceError("G7", "metadata", structure);
  }
  let value;
  try {
    value = parseCanonicalJson(bytes);
  } catch (err) {
    if (err instanceof CanonicalJsonError) {
      throw new NotaConformanceError("SCHEMA", "metadata", `must be canonical JSON: ${err.message}`);
    }
    throw err;
  }
  if (!isPlainObject(value)) {
    throw new NotaConformanceError("SCHEMA", "metadata", "must be a JSON object");
  }
  return value as JsonObject;
}

/**
 * Serializes a metadata object as the canonical `META` payload and validates
 * the result. Strings are written as given; normalize to NFC first (see
 * `composeNotaDraft`, which does).
 *
 * @throws NotaConformanceError if the metadata cannot be minted.
 */
export function encodeMetadata(metadata: Record<string, unknown>): Uint8Array {
  if (!isPlainObject(metadata)) {
    throw new NotaConformanceError("SCHEMA", "metadata", "must be a JSON object");
  }
  let bytes: Uint8Array;
  try {
    bytes = canonicalBytes(metadata);
  } catch (err) {
    if (err instanceof CanonicalJsonError) {
      throw new NotaConformanceError(
        err.reason === "depth" ? "G7" : "SCHEMA",
        "metadata",
        err.message
      );
    }
    throw err;
  }
  validateMetadataBytes(bytes);
  return bytes;
}
