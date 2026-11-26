/**
 * Content Safety Rules T1 through T6 (protocol/v1.1/10-conformance-gate.md).
 *
 * The rules apply to every string in the content layer and to the raw bytes
 * of every JSON payload. Readers enforce the same rules as the on-chain gate,
 * so a file with a fabricated receipt cannot deliver content the gate would
 * have refused.
 */

import { Utf8Error, decodeUtf8 } from "../utf8.js";

/** A Content Safety Rule. */
export type SafetyRule = "T1" | "T2" | "T3" | "T4" | "T5" | "T6";

/** What each rule refuses, for error messages. */
export const SAFETY_RULE_NAMES: Readonly<Record<SafetyRule, string>> = Object.freeze({
  T1: "malformed UTF-8",
  T2: "control character",
  T3: "bidirectional control",
  T4: "invisible or formatting character",
  T5: "exotic space",
  T6: "private-use character or noncharacter",
});

/** The first violation of the Content Safety Rules found in a string or byte run. */
export interface SafetyViolation {
  rule: SafetyRule;
  /** The refused code point, or `null` when the input was not decodable (T1). */
  codePoint: number | null;
  /** UTF-16 code unit index (strings) or byte offset (bytes) of the violation. */
  index: number;
  message: string;
}

/**
 * Classifies one code point. Returns the rule that refuses it, or `null` if
 * the code point is permitted.
 */
export function classifyCodePoint(cp: number): SafetyRule | null {
  // T1: surrogates and anything above U+10FFFF are not Unicode scalar values.
  if (cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "T1";
  // T2: C0 controls, DEL, C1 controls.
  if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return "T2";
  if (cp < 0xa0) return null; // remaining ASCII: U+0020 to U+007E
  // T3: bidirectional controls.
  if (
    cp === 0x061c ||
    cp === 0x200e ||
    cp === 0x200f ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069)
  ) {
    return "T3";
  }
  // T4: invisible and formatting characters.
  if (
    cp === 0x00ad ||
    cp === 0x034f ||
    cp === 0x180e ||
    (cp >= 0x200b && cp <= 0x200d) ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    (cp >= 0x2060 && cp <= 0x2064) ||
    cp === 0xfeff ||
    (cp >= 0xfff9 && cp <= 0xfffb) ||
    (cp >= 0xe0000 && cp <= 0xe007f)
  ) {
    return "T4";
  }
  // T5: every space other than U+0020.
  if (
    cp === 0x00a0 ||
    cp === 0x1680 ||
    (cp >= 0x2000 && cp <= 0x200a) ||
    cp === 0x202f ||
    cp === 0x205f ||
    cp === 0x3000
  ) {
    return "T5";
  }
  // T6: private use, noncharacters, and the last two code points of every plane.
  if (
    (cp >= 0xe000 && cp <= 0xf8ff) ||
    (cp >= 0xfdd0 && cp <= 0xfdef) ||
    (cp & 0xfffe) === 0xfffe ||
    cp >= 0xf0000
  ) {
    return "T6";
  }
  return null;
}

/** First Content Safety violation in a string, or `null` if the string is safe. */
export function findTextSafetyViolation(text: string): SafetyViolation | null {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    let cp = unit;
    let width = 1;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        cp = 0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00);
        width = 2;
      }
    }
    if (cp < 0x80 && cp > 0x1f && cp !== 0x7f) continue; // printable ASCII fast path
    const rule = classifyCodePoint(cp);
    if (rule !== null) {
      return {
        rule,
        codePoint: cp,
        index: i,
        message:
          rule === "T1"
            ? `lone surrogate ${formatCodePoint(cp)} at index ${i}`
            : `${SAFETY_RULE_NAMES[rule]} ${formatCodePoint(cp)} at index ${i}`,
      };
    }
    i += width - 1;
  }
  return null;
}

/**
 * First Content Safety violation in a run of bytes that should be UTF-8, or
 * `null` if the bytes are safe. Malformed UTF-8 is a T1 violation.
 */
export function findUtf8SafetyViolation(bytes: Uint8Array): SafetyViolation | null {
  let text: string;
  try {
    text = decodeUtf8(bytes);
  } catch (err) {
    if (err instanceof Utf8Error) {
      return {
        rule: "T1",
        codePoint: null,
        index: err.index,
        message: `${SAFETY_RULE_NAMES.T1} at byte ${err.index}: ${err.message}`,
      };
    }
    throw err;
  }
  return findTextSafetyViolation(text);
}

/** True when a string satisfies T1 through T6. */
export function isSafeText(text: string): boolean {
  return findTextSafetyViolation(text) === null;
}

/** `U+XXXX` notation for a code point. */
export function formatCodePoint(cp: number): string {
  return "U+" + cp.toString(16).toUpperCase().padStart(4, "0");
}
