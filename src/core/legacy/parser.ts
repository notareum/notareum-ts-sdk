/**
 * Legacy v1.0 `.nota` JSON document parser.
 *
 * Parses a JSON string into a v1.0 NotaFile object with structural validation.
 * A v1.0 document is not a v1.1 `.nota` file; use `importLegacyNota` to map
 * one onto a v1.1 draft.
 */

import { NotaParseError } from "../errors.js";
import type { NotaFile } from "./types.js";

/**
 * Parses a .nota file from a JSON string.
 *
 * @param input - Raw JSON string content of a .nota file.
 * @returns Parsed NotaFile object.
 * @throws NotaParseError if the input is not valid JSON or is missing required top-level fields.
 */
export function parseNota(input: string): NotaFile {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input);
  } catch (err) {
    throw new NotaParseError(
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new NotaParseError("Root element must be a JSON object.");
  }

  const obj = parsed as Record<string, unknown>;

  // Check required top-level fields
  const required = ["version", "type", "chain", "resource", "signature"] as const;
  for (const field of required) {
    if (!(field in obj)) {
      throw new NotaParseError(`Missing required field: "${field}".`);
    }
  }

  return obj as unknown as NotaFile;
}

/**
 * Serializes a NotaFile to a canonical JSON string.
 * Keys are sorted alphabetically at each level.
 *
 * @param nota - The NotaFile to serialize.
 * @returns JSON string representation.
 */
export function serializeNota(nota: NotaFile): string {
  return JSON.stringify(nota, sortedReplacer, 2);
}

/** JSON replacer that sorts keys alphabetically. */
function sortedReplacer(
  _key: string,
  value: unknown
): unknown {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}
