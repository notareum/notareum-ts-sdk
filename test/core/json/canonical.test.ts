/**
 * RFC 8785 canonical JSON: serialization, and the canonical-form check that
 * every JSON payload of a container must pass.
 */

import { describe, it, expect } from "vitest";
import { CanonicalJsonError } from "../../../src/core/errors.js";
import {
  canonicalBytes,
  canonicalize,
  decodeUtf8,
  encodeUtf8,
  isCanonicalJson,
  jsonNestingDepth,
  parseCanonicalJson,
  utf8ByteLength,
  Utf8Error,
} from "../../../src/core/json/index.js";

const utf8 = (s: string) => new TextEncoder().encode(s);

function reasonOf(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(CanonicalJsonError);
    return (err as CanonicalJsonError).reason;
  }
  throw new Error("accepted");
}

describe("canonicalize (RFC 8785)", () => {
  it("serializes literals, with no insignificant whitespace", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(false)).toBe("false");
    expect(canonicalize([])).toBe("[]");
    expect(canonicalize({})).toBe("{}");
    expect(canonicalize({ b: [1, "two", null, true], a: { d: 1, c: 2 } })).toBe(
      '{"a":{"c":2,"d":1},"b":[1,"two",null,true]}'
    );
  });

  it("sorts member names by UTF-16 code unit (RFC 8785 section 3.2.3)", () => {
    // The RFC's own sorting example.
    const input = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      "דּ": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "\u0080": "Control",
      "ö": "Latin Small Letter O With Diaeresis",
    };
    // Read the order from the text: a parsed object would list "1" first.
    const text = canonicalize(input);
    const order = [...text.matchAll(/:"([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual([
      "Carriage Return",
      "One",
      "Control",
      "Latin Small Letter O With Diaeresis",
      "Euro Sign",
      "Emoji: Grinning Face",
      "Hebrew Letter Dalet With Dagesh",
    ]);
  });

  it("orders numeric-looking names as strings, not numbers", () => {
    expect(canonicalize({ "10": 1, "9": 2, "1": 3, a: 4, B: 5 })).toBe('{"1":3,"10":1,"9":2,"B":5,"a":4}');
  });

  it("serializes numbers as ECMAScript does (RFC 8785 section 3.2.2.3)", () => {
    const cases: [number, string][] = [
      [0, "0"],
      [-0, "0"],
      [1, "1"],
      [-1, "-1"],
      [1.5, "1.5"],
      [1e21, "1e+21"],
      [1e-7, "1e-7"],
      [0.000001, "0.000001"],
      [100, "100"],
      [9007199254740991, "9007199254740991"],
      [333333333.3333333, "333333333.3333333"],
      [4.5, "4.5"],
      [2e-3, "0.002"],
      [1e30, "1e+30"],
      [5e-324, "5e-324"],
      [1.7976931348623157e308, "1.7976931348623157e+308"],
    ];
    for (const [value, text] of cases) expect(canonicalize(value)).toBe(text);
  });

  it("escapes only the quote, the backslash and control characters", () => {
    expect(canonicalize('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(canonicalize("\b\t\n\f\r")).toBe('"\\b\\t\\n\\f\\r"');
    expect(canonicalize("\u0000\u001f\u000b")).toBe('"\\u0000\\u001f\\u000b"');
    // Everything else is literal, including DEL, '/', '<' and non-ASCII.
    expect(canonicalize("\u007f/<>&é €😀")).toBe('"\u007f/<>&é €😀"');
  });

  it("refuses values JSON cannot represent instead of dropping them", () => {
    expect(reasonOf(() => canonicalize(undefined))).toBe("unsupported-value");
    expect(reasonOf(() => canonicalize({ a: undefined }))).toBe("unsupported-value");
    expect(reasonOf(() => canonicalize([1, , 3]))).toBe("unsupported-value"); // eslint-disable-line no-sparse-arrays
    expect(reasonOf(() => canonicalize(NaN))).toBe("unsupported-value");
    expect(reasonOf(() => canonicalize(Infinity))).toBe("unsupported-value");
    expect(reasonOf(() => canonicalize(10n))).toBe("unsupported-value");
    expect(reasonOf(() => canonicalize(() => 1))).toBe("unsupported-value");
    expect(reasonOf(() => canonicalize(Symbol("x")))).toBe("unsupported-value");
    expect(reasonOf(() => canonicalize(new Date(0)))).toBe("unsupported-value");
    expect(reasonOf(() => canonicalize(new Map()))).toBe("unsupported-value");
    expect(reasonOf(() => canonicalize(new Uint8Array(2)))).toBe("unsupported-value");
    expect(reasonOf(() => canonicalize("lone \ud800 surrogate"))).toBe("unsupported-value");
    expect(reasonOf(() => canonicalize({ "\udc00": 1 }))).toBe("unsupported-value");
  });

  it("limits nesting depth, 8 by default", () => {
    const nest = (depth: number): unknown => (depth === 0 ? 1 : { a: nest(depth - 1) });
    expect(() => canonicalize(nest(8))).not.toThrow();
    expect(reasonOf(() => canonicalize(nest(9)))).toBe("depth");
    expect(() => canonicalize(nest(9), { maxDepth: 9 })).not.toThrow();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(reasonOf(() => canonicalize(cyclic))).toBe("depth");
  });

  it("canonicalBytes is the UTF-8 encoding, without a byte order mark", () => {
    const bytes = canonicalBytes({ name: "café" });
    expect(Array.from(bytes.subarray(0, 3))).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(decodeUtf8(bytes)).toBe('{"name":"café"}');
  });
});

describe("parseCanonicalJson: the canonical-form check", () => {
  it("accepts canonical JSON and returns the value", () => {
    const value = { a: [1, 2, { b: null }], c: "d", e: 1.5, f: true };
    expect(parseCanonicalJson(canonicalBytes(value))).toEqual(value);
    expect(isCanonicalJson(utf8("{}"))).toBe(true);
    expect(isCanonicalJson(utf8('{"a":"\\"\\\\"}'))).toBe(true);
  });

  it("round-trips whatever canonicalize produces", () => {
    const values = [
      { "€": 1, "😀": 2, "ö": 3, "1": 4 },
      { n: [0, -1, 1e21, 1e-7, 0.1, 9007199254740991] },
      { s: 'quote " backslash \\ unicode é 日本 😀' },
      { nested: { a: { b: { c: { d: { e: { f: 1 } } } } } } },
      [],
      "",
    ];
    for (const value of values) {
      expect(parseCanonicalJson(canonicalBytes(value))).toEqual(value);
    }
  });

  it.each([
    ["a space after a colon", '{"a": 1}'],
    ["a space after a comma", '{"a":1, "b":2}'],
    ["leading whitespace", ' {"a":1}'],
    ["trailing whitespace", '{"a":1} '],
    ["a trailing newline", '{"a":1}\n'],
    ["unsorted members", '{"b":1,"a":2}'],
    ["a duplicate member", '{"a":1,"a":1}'],
    ["a duplicate member with different values", '{"a":1,"a":2}'],
    ["a trailing-zero number", '{"a":1.0}'],
    ["an exponent number", '{"a":1e2}'],
    ["a capital exponent", '{"a":1E+21}'],
    ["a negative zero", '{"a":-0}'],
    ["an integer beyond double precision", '{"a":9007199254740993}'],
    ["a \\u escape for a printable character", '{"a":"\\u0041"}'],
    ["an uppercase \\u escape for a control", '{"a":"\\u001F"}'],
    ["a \\u escape where a short escape exists", '{"a":"\\u000a"}'],
    ["an escaped solidus", '{"a":"\\/"}'],
    ["a surrogate-pair escape", '{"a":"\\ud83d\\ude00"}'],
    ["a byte order mark", '﻿{"a":1}'],
  ])("rejects %s as non-canonical", (_name, text) => {
    expect(reasonOf(() => parseCanonicalJson(utf8(text)))).toBe("non-canonical");
    expect(isCanonicalJson(utf8(text))).toBe(false);
  });

  it.each([
    ["an empty input", ""],
    ["a truncated object", '{"a":1'],
    ["a trailing comma", '{"a":1,}'],
    ["single quotes", "{'a':1}"],
    ["a comment", '{"a":1}//x'],
    ["NaN", '{"a":NaN}'],
    ["a leading zero", '{"a":01}'],
    ["two values", "{}{}"],
    ["a raw control character in a string", '{"a":"b\nc"}'],
    ["a lone surrogate escape", '{"a":"\\ud800"}'],
  ])("rejects %s", (_name, text) => {
    expect(["syntax", "non-canonical", "unsupported-value"]).toContain(
      reasonOf(() => parseCanonicalJson(utf8(text)))
    );
  });

  it("rejects malformed UTF-8 rather than repairing it", () => {
    const bytes = Uint8Array.from([...utf8('{"a":"'), 0xc0, 0xaf, ...utf8('"}')]);
    expect(reasonOf(() => parseCanonicalJson(bytes))).toBe("utf8");
    expect(reasonOf(() => parseCanonicalJson(Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])))).toBe("non-canonical");
  });

  it("rejects nesting deeper than the limit before parsing", () => {
    expect(reasonOf(() => parseCanonicalJson(utf8("[[[[[[[[[1]]]]]]]]]")))).toBe("depth");
    expect(parseCanonicalJson(utf8("[[[[[[[[1]]]]]]]]"))).toEqual([[[[[[[[1]]]]]]]]);
    expect(reasonOf(() => parseCanonicalJson(utf8("[".repeat(100_000))))).toBe("depth");
  });

  it("measures depth outside strings only", () => {
    expect(jsonNestingDepth('{"a":"[[[[{{{{"}')).toBe(1);
    expect(jsonNestingDepth('{"a":"\\"[["}')).toBe(1);
    expect(jsonNestingDepth('{"a":[{"b":[]}]}')).toBe(4);
    expect(jsonNestingDepth('"x"')).toBe(0);
  });
});

describe("strict UTF-8", () => {
  it("round-trips every plane", () => {
    const text = "Aé€😀�";
    expect(decodeUtf8(encodeUtf8(text))).toBe(text);
    expect(utf8ByteLength(text)).toBe(encodeUtf8(text).length);
    expect(utf8ByteLength("")).toBe(0);
  });

  it("keeps a byte order mark as a character instead of stripping it", () => {
    expect(decodeUtf8(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41]))).toBe("﻿A");
  });

  it("throws on malformed input", () => {
    expect(() => decodeUtf8(Uint8Array.from([0xff]))).toThrow(Utf8Error);
    expect(() => decodeUtf8(Uint8Array.from([0xed, 0xa0, 0x80]))).toThrow(/surrogate/);
    expect(() => decodeUtf8(Uint8Array.from([0xe0, 0x80, 0x80]))).toThrow(/overlong/);
    expect(() => encodeUtf8("\ud800")).toThrow(Utf8Error);
  });

  it("decodes long inputs", () => {
    const text = "日本語😀".repeat(5000);
    expect(decodeUtf8(new TextEncoder().encode(text))).toBe(text);
  });
});
