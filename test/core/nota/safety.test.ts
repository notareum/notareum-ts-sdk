/**
 * Content Safety Rules T1 through T6 (protocol/v1.1/10-conformance-gate.md):
 * one test per forbidden code point class, at each layer that enforces them.
 */

import { describe, it, expect } from "vitest";
import { readContainer } from "../../../src/core/container/index.js";
import { NotaConformanceError, NotaContainerError } from "../../../src/core/errors.js";
import {
  checkContent,
  classifyCodePoint,
  encodeMetadata,
  findTextSafetyViolation,
  findUtf8SafetyViolation,
  isSafeText,
  validateContent,
  validateMetadataBytes,
} from "../../../src/core/nota/index.js";
import { exampleContent, jsonPayload, mintedBodyWith, plainContent, utf8 } from "../fixtures.js";

/** Every code point in the inclusive ranges. */
function points(...ranges: (number | [number, number])[]): number[] {
  const out: number[] = [];
  for (const r of ranges) {
    if (typeof r === "number") out.push(r);
    else for (let cp = r[0]; cp <= r[1]; cp++) out.push(cp);
  }
  return out;
}

const cpName = (cp: number): string => "U+" + cp.toString(16).toUpperCase().padStart(4, "0");

/** The forbidden classes, exactly as the rule table lists them. */
const CLASSES: { rule: string; name: string; codePoints: number[] }[] = [
  { rule: "T2", name: "C0 control characters U+0000 to U+001F", codePoints: points([0x00, 0x1f]) },
  { rule: "T2", name: "DEL and C1 control characters U+007F to U+009F", codePoints: points([0x7f, 0x9f]) },
  {
    rule: "T3",
    name: "bidirectional controls",
    codePoints: points(0x061c, 0x200e, 0x200f, [0x202a, 0x202e], [0x2066, 0x2069]),
  },
  {
    rule: "T4",
    name: "invisible and formatting characters",
    codePoints: points(0x00ad, 0x034f, 0x180e, [0x200b, 0x200d], 0x2028, 0x2029, [0x2060, 0x2064], 0xfeff, [0xfff9, 0xfffb]),
  },
  { rule: "T4", name: "tag characters U+E0000 to U+E007F", codePoints: points([0xe0000, 0xe007f]) },
  {
    rule: "T5",
    name: "exotic spaces",
    codePoints: points(0x00a0, 0x1680, [0x2000, 0x200a], 0x202f, 0x205f, 0x3000),
  },
  { rule: "T6", name: "BMP private use U+E000 to U+F8FF", codePoints: points([0xe000, 0xf8ff]) },
  { rule: "T6", name: "noncharacters U+FDD0 to U+FDEF", codePoints: points([0xfdd0, 0xfdef]) },
  { rule: "T6", name: "noncharacters U+FFFE and U+FFFF", codePoints: points(0xfffe, 0xffff) },
  {
    rule: "T6",
    name: "the last two code points of every plane",
    codePoints: Array.from({ length: 17 }, (_, plane) => [plane * 0x10000 + 0xfffe, plane * 0x10000 + 0xffff]).flat(),
  },
  {
    rule: "T6",
    name: "supplementary private use U+F0000 to U+10FFFF (sampled)",
    codePoints: points([0xf0000, 0xf00ff], 0xffffd, 0x100000, 0x10abcd, [0x10ff00, 0x10ffff]),
  },
];

describe("classifyCodePoint: one test per forbidden class", () => {
  it.each(CLASSES)("$rule refuses $name", ({ rule, codePoints }) => {
    for (const cp of codePoints) {
      expect(classifyCodePoint(cp), cpName(cp)).toBe(rule);
    }
  });

  it("T1 refuses surrogates and anything above U+10FFFF", () => {
    for (const cp of points([0xd800, 0xdfff], 0x110000, 0x1fffff)) {
      expect(classifyCodePoint(cp), cpName(cp)).toBe("T1");
    }
  });

  it("refuses exactly the listed code points and no others", () => {
    const forbidden = new Set<number>();
    for (const c of CLASSES) for (const cp of c.codePoints) forbidden.add(cp);
    for (let cp = 0; cp <= 0xefffd; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue; // T1
      const expected = forbidden.has(cp);
      if ((classifyCodePoint(cp) !== null) !== expected) {
        throw new Error(`${cpName(cp)}: expected ${expected ? "refused" : "permitted"}`);
      }
    }
    // Planes 15 and 16 are private use in full.
    for (let cp = 0xf0000; cp <= 0x10ffff; cp += 0x101) expect(classifyCodePoint(cp)).toBe("T6");
  });

  it("permits U+0020 as the only space, and ordinary text in any script", () => {
    expect(classifyCodePoint(0x20)).toBeNull();
    for (const text of [
      "Example Treasury",
      "~!@#$%^&*()_+{}|:\"<>?",
      "Ünïcödé café",
      "日本語のテキスト",
      "Привет",
      "مرحبا",
      "😀 emoji",
      "¡¿", // first printable Latin-1 after the C1 block and U+00A0
      "�", // the replacement character is not a noncharacter
    ]) {
      expect(isSafeText(text), text).toBe(true);
    }
  });
});

describe("strings: findTextSafetyViolation", () => {
  it.each(CLASSES)("$rule: $name", ({ rule, codePoints }) => {
    for (const cp of codePoints) {
      const text = "ab" + String.fromCodePoint(cp) + "cd";
      const violation = findTextSafetyViolation(text);
      expect(violation?.rule, cpName(cp)).toBe(rule);
      expect(violation?.codePoint).toBe(cp);
      expect(violation?.index).toBe(2);
    }
  });

  it("T1: a lone surrogate in a string", () => {
    expect(findTextSafetyViolation("ab\ud800cd")?.rule).toBe("T1");
    expect(findTextSafetyViolation("ab\udc00cd")?.rule).toBe("T1");
    expect(findTextSafetyViolation("\ud83d")?.rule).toBe("T1");
    // A proper pair is one code point and is judged as such.
    expect(findTextSafetyViolation("😀")).toBeNull();
  });

  it("reports the first violation", () => {
    const violation = findTextSafetyViolation("ok then‮");
    expect(violation).toMatchObject({ rule: "T5", codePoint: 0xa0, index: 2 });
  });
});

describe("bytes: T1, well-formed UTF-8", () => {
  it.each([
    ["an overlong two-byte encoding of '/'", [0xc0, 0xaf]],
    ["an overlong two-byte encoding of NUL", [0xc0, 0x80]],
    ["an overlong three-byte encoding", [0xe0, 0x80, 0xaf]],
    ["an overlong four-byte encoding", [0xf0, 0x80, 0x80, 0xaf]],
    ["an encoded high surrogate U+D800", [0xed, 0xa0, 0x80]],
    ["an encoded low surrogate U+DFFF", [0xed, 0xbf, 0xbf]],
    ["a code point above U+10FFFF", [0xf4, 0x90, 0x80, 0x80]],
    ["a five-byte lead byte", [0xf8, 0x88, 0x80, 0x80, 0x80]],
    ["a stray continuation byte", [0x80]],
    ["a truncated sequence", [0xe2, 0x82]],
    ["a lead byte followed by ASCII", [0xc3, 0x28]],
  ])("refuses %s", (_name, sequence) => {
    const bytes = Uint8Array.from([0x61, ...sequence, 0x62]);
    const violation = findUtf8SafetyViolation(bytes);
    expect(violation?.rule).toBe("T1");
    expect(violation?.codePoint).toBeNull();
  });

  it("applies T2 through T6 to the decoded code points", () => {
    expect(findUtf8SafetyViolation(utf8("a‮b"))?.rule).toBe("T3");
    expect(findUtf8SafetyViolation(utf8("a b"))?.rule).toBe("T5");
    expect(findUtf8SafetyViolation(utf8("plain text, 日本語, 😀"))).toBeNull();
  });
});

describe("content validator: every string member is checked", () => {
  const samples: [string, number][] = [
    ["T2", 0x0007],
    ["T2", 0x0085],
    ["T3", 0x202e],
    ["T4", 0x200b],
    ["T5", 0x00a0],
    ["T6", 0xe000],
  ];

  it.each(samples)("%s in resource.name is refused", (rule, cp) => {
    const content = plainContent();
    content.resource.name = "Treasury" + String.fromCodePoint(cp) + "Fund";
    const issues = checkContent(content);
    expect(issues.some((i) => i.rule === rule && i.field === "resource.name")).toBe(true);
    try {
      validateContent(content);
      throw new Error("accepted");
    } catch (err) {
      expect(err).toBeInstanceOf(NotaConformanceError);
      expect((err as NotaConformanceError).rule).toBe(rule);
      expect((err as NotaConformanceError).field).toBe("resource.name");
    }
  });

  it("T1: a lone surrogate in a member is refused", () => {
    const content = plainContent();
    content.issuer.name = "Example\ud800";
    expect(checkContent(content).some((i) => i.rule === "T1" && i.field === "issuer.name")).toBe(true);
  });

  it.each([
    "type",
    "chain.name",
    "chain.network",
    "resource.identifier",
    "resource.name",
    "resource.alias",
    "resource.description",
    "issuer.account",
    "issuer.name",
    "issuer.entityType",
    "version",
    "metadataHash",
    "supersedes",
  ])("a right-to-left override in %s is refused as T3", (path) => {
    const content = plainContent() as unknown as Record<string, Record<string, string> | string>;
    const [head, leaf] = path.split(".");
    if (leaf === undefined) content[head] = (content[head] as string) + "‮";
    else (content[head] as Record<string, string>)[leaf] += "‮";
    expect(checkContent(content).some((i) => i.rule === "T3" && i.field === path)).toBe(true);
  });
});

describe("container reader: each class is refused inside a file", () => {
  it.each(CLASSES)("$rule in the content layer: $name", ({ rule, codePoints }) => {
    // First and last code point of each class.
    for (const cp of [codePoints[0], codePoints[codePoints.length - 1]]) {
      const content = exampleContent();
      content.resource.description = "x" + String.fromCodePoint(cp) + "y";
      // JSON escapes C0 controls; everything else is written literally.
      const file = mintedBodyWith({ CONT: jsonPayload(content) });
      try {
        readContainer(file);
        throw new Error(`${cpName(cp)} accepted`);
      } catch (err) {
        expect(err, cpName(cp)).toBeInstanceOf(NotaContainerError);
        expect((err as NotaContainerError).code).toBe("CONTENT_SAFETY");
        expect((err as NotaContainerError).rule).toBe(rule);
      }
    }
  });

  it("T1 in the metadata", () => {
    const bytes = Uint8Array.from([...utf8('{"k":"'), 0xed, 0xa0, 0x80, ...utf8('"}')]);
    try {
      readContainer(mintedBodyWith({ META: bytes }));
      throw new Error("accepted");
    } catch (err) {
      expect((err as NotaContainerError).code).toBe("CONTENT_SAFETY");
      expect((err as NotaContainerError).rule).toBe("T1");
    }
  });
});

describe("metadata bytes: the rules apply to the raw bytes", () => {
  it.each([
    ["T2", "\u0085"],
    ["T3", "⁧"],
    ["T4", "﻿"],
    ["T5", "　"],
    ["T6", "󰀀"], // U+F0000
  ])("%s is refused by encodeMetadata and validateMetadataBytes", (rule, ch) => {
    const metadata = { tags: ["a" + ch + "b"] };
    for (const run of [
      () => encodeMetadata(metadata),
      () => validateMetadataBytes(jsonPayload(metadata)),
    ]) {
      try {
        run();
        throw new Error("accepted");
      } catch (err) {
        expect(err).toBeInstanceOf(NotaConformanceError);
        expect((err as NotaConformanceError).rule).toBe(rule);
      }
    }
  });

  it("refuses a control character however it is written", () => {
    // Raw: T2 on the bytes. Escaped: the structural scan, since a backslash
    // may be followed only by '"' or '\'.
    expect(() => validateMetadataBytes(utf8('{"k":"a\nb"}'))).toThrow(/T2/);
    expect(() => validateMetadataBytes(utf8('{"k":"a\\nb"}'))).toThrow(/G7/);
    expect(() => validateMetadataBytes(utf8('{"k":"a\\u000ab"}'))).toThrow(/G7/);
    expect(() => validateMetadataBytes(utf8('{"k":"a\\u202eb"}'))).toThrow(/G7/);
    expect(() => encodeMetadata({ k: "a\nb" })).toThrow(NotaConformanceError);
  });

  it('permits the two escapes canonical JSON needs: \\" and \\\\', () => {
    const bytes = encodeMetadata({ quote: 'say "hi"', path: "a\\b" });
    expect(validateMetadataBytes(bytes)).toEqual({ quote: 'say "hi"', path: "a\\b" });
  });
});
