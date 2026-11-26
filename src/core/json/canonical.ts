/**
 * Canonical JSON: the RFC 8785 JSON Canonicalization Scheme (JCS), UTF-8
 * encoded, with no byte order mark and no duplicate member names.
 *
 * Every JSON payload of a `.nota` container has exactly one valid byte
 * representation. `canonicalize` produces it; `parseCanonicalJson` accepts
 * nothing else.
 */

import { NOTA_MAX_JSON_DEPTH } from "../constants.js";
import { CanonicalJsonError } from "../errors.js";
import { Utf8Error, decodeUtf8, encodeUtf8, findLoneSurrogate } from "../utf8.js";

/** A JSON value. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [member: string]: JsonValue };

/** A JSON object. */
export type JsonObject = { [member: string]: JsonValue };

export interface CanonicalJsonOptions {
  /**
   * Deepest permitted nesting of objects and arrays; a top-level object or
   * array is depth 1. Defaults to the `.nota` payload limit of 8.
   */
  maxDepth?: number;
}

/**
 * Serializes a value as canonical JSON text (RFC 8785).
 *
 * Member names are sorted by UTF-16 code unit, numbers use the ECMAScript
 * shortest round-trip form, and strings escape only `"`, `\` and control
 * characters. Unlike `JSON.stringify`, nothing is dropped or coerced: values
 * JSON cannot represent are an error.
 *
 * @throws CanonicalJsonError for `undefined`, functions, symbols, bigints,
 *   non-finite numbers, lone surrogates, objects that are not plain objects
 *   or arrays, and nesting deeper than `maxDepth`.
 */
export function canonicalize(value: unknown, options: CanonicalJsonOptions = {}): string {
  return serialize(value, 1, options.maxDepth ?? NOTA_MAX_JSON_DEPTH, "$");
}

/** Canonical JSON of `value`, UTF-8 encoded. See {@link canonicalize}. */
export function canonicalBytes(value: unknown, options: CanonicalJsonOptions = {}): Uint8Array {
  return encodeUtf8(canonicalize(value, options));
}

function serialize(value: unknown, depth: number, maxDepth: number, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError("unsupported-value", `${path}: ${value} is not a JSON number`);
      }
      // ECMAScript Number-to-String, which RFC 8785 mandates. Negative zero becomes "0".
      return JSON.stringify(value);
    case "string":
      return serializeString(value, path);
    case "object":
      break;
    default:
      throw new CanonicalJsonError(
        "unsupported-value",
        `${path}: a ${typeof value} has no JSON representation`
      );
  }

  if (depth > maxDepth) {
    throw new CanonicalJsonError("depth", `${path}: nesting deeper than ${maxDepth}`);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let i = 0; i < value.length; i++) {
      // A hole in a sparse array reads as undefined and is rejected below.
      items.push(serialize(value[i], depth + 1, maxDepth, `${path}[${i}]`));
    }
    return "[" + items.join(",") + "]";
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new CanonicalJsonError(
      "unsupported-value",
      `${path}: only plain objects and arrays have a JSON representation`
    );
  }
  const object = value as Record<string, unknown>;
  // Array.prototype.sort on strings orders by UTF-16 code unit, as RFC 8785 requires.
  const names = Object.keys(object).sort();
  const members: string[] = [];
  for (const name of names) {
    members.push(
      serializeString(name, path) +
        ":" +
        serialize(object[name], depth + 1, maxDepth, `${path}.${name}`)
    );
  }
  return "{" + members.join(",") + "}";
}

function serializeString(text: string, path: string): string {
  if (findLoneSurrogate(text) >= 0) {
    throw new CanonicalJsonError("unsupported-value", `${path}: string contains a lone surrogate`);
  }
  // For well-formed strings JSON.stringify emits exactly the RFC 8785 form:
  // \" \\ \b \f \n \r \t, \u00xx (lowercase) for other controls, all else literal.
  return JSON.stringify(text);
}

/**
 * Deepest nesting of braces and brackets outside strings. This is the gate's
 * one-pass structural measure; it does not validate JSON grammar.
 */
export function jsonNestingDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) i++; // backslash: skip the escaped character
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) {
      inString = true;
    } else if (c === 0x7b || c === 0x5b) {
      depth++;
      if (depth > max) max = depth;
    } else if (c === 0x7d || c === 0x5d) {
      depth--;
    }
  }
  return max;
}

/**
 * Parses bytes that MUST be canonical JSON, and returns the value.
 *
 * The bytes are accepted only if they are well-formed UTF-8 with no byte order
 * mark, parse as JSON, nest no deeper than `maxDepth`, and are byte-identical
 * to the canonical serialization of the parsed value. That last comparison
 * rejects insignificant whitespace, unsorted or duplicate member names,
 * non-shortest numbers, and unnecessary escapes in one step.
 *
 * @throws CanonicalJsonError with `reason` set to `utf8`, `syntax`, `depth`
 *   or `non-canonical`.
 */
export function parseCanonicalJson(
  bytes: Uint8Array,
  options: CanonicalJsonOptions = {}
): JsonValue {
  let text: string;
  try {
    text = decodeUtf8(bytes);
  } catch (err) {
    if (err instanceof Utf8Error) {
      throw new CanonicalJsonError("utf8", `malformed UTF-8 at byte ${err.index}: ${err.message}`);
    }
    throw err;
  }
  return parseCanonicalJsonText(text, options);
}

/** As {@link parseCanonicalJson}, for text that has already been strictly decoded. */
export function parseCanonicalJsonText(
  text: string,
  options: CanonicalJsonOptions = {}
): JsonValue {
  const maxDepth = options.maxDepth ?? NOTA_MAX_JSON_DEPTH;
  if (text.charCodeAt(0) === 0xfeff) {
    throw new CanonicalJsonError("non-canonical", "byte order mark");
  }
  // Checked before parsing so that hostile nesting never reaches a recursive walk.
  if (jsonNestingDepth(text) > maxDepth) {
    throw new CanonicalJsonError("depth", `nesting deeper than ${maxDepth}`);
  }
  let value: JsonValue;
  try {
    value = JSON.parse(text) as JsonValue;
  } catch (err) {
    throw new CanonicalJsonError(
      "syntax",
      `not JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const canonical = canonicalize(value, { maxDepth });
  if (canonical !== text) {
    let at = 0;
    while (at < canonical.length && at < text.length && canonical[at] === text[at]) at++;
    throw new CanonicalJsonError(
      "non-canonical",
      `not the canonical serialization (first difference at character ${at})`
    );
  }
  return value;
}

/** True when `bytes` are canonical JSON. Never throws. */
export function isCanonicalJson(bytes: Uint8Array, options: CanonicalJsonOptions = {}): boolean {
  try {
    parseCanonicalJson(bytes, options);
    return true;
  } catch {
    return false;
  }
}
