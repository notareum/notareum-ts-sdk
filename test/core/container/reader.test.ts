/**
 * The strict reader: one rejection test (at least) per rule of "Reading a
 * File" in protocol/v1.1/01-nota-format.md. There is no lenient mode, so
 * every case must throw.
 */

import { describe, it, expect } from "vitest";
import {
  appendRevision,
  concatBytes,
  encodeHeader,
  encodeObject,
  readContainer,
  hasNotaMagic,
} from "../../../src/core/container/index.js";
import type { ObjectInput, XrefEntry } from "../../../src/core/container/index.js";
import { NotaContainerError } from "../../../src/core/errors.js";
import type { NotaContainerErrorCode } from "../../../src/core/errors.js";
import { canonicalize } from "../../../src/core/json/index.js";
import { readNota } from "../../../src/core/nota/index.js";
import {
  buildContainer,
  exampleContent,
  exampleObjects,
  exampleStatus,
  jsonPayload,
  layoutRevision0,
  loadExample,
  mintedBodyWith,
  resealRevision0,
  utf8,
  withAnnex,
} from "../fixtures.js";

const registered = loadExample("address-registered.nota");
const verified = loadExample("address-verified.nota");

/** Both entry points must refuse the file, with the given code. */
function expectRejected(file: Uint8Array, code: NotaContainerErrorCode): NotaContainerError {
  let caught: unknown;
  try {
    readContainer(file);
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected ${code}, but the container was accepted`).toBeInstanceOf(NotaContainerError);
  expect((caught as NotaContainerError).code).toBe(code);
  expect(() => readNota(file)).toThrow(NotaContainerError);
  return caught as NotaContainerError;
}

function flip(file: Uint8Array, offset: number): Uint8Array {
  const out = file.slice();
  out[offset] ^= 0x01;
  return out;
}

const stat = (number: number): ObjectInput => ({
  type: "STAT",
  number,
  payload: jsonPayload(exampleStatus()),
});

/** Revision 0 of the example as raw encoded objects, with their XREF entries. */
function exampleLayout(): { segments: Uint8Array[]; entries: XrefEntry[] } {
  const segments: Uint8Array[] = [];
  const entries: XrefEntry[] = [];
  let offset = 16;
  for (const o of exampleObjects()) {
    const bytes = encodeObject(o.type, o.number, o.payload);
    segments.push(bytes);
    entries.push({ type: o.type, number: o.number, offset, length: o.payload.length });
    offset += bytes.length;
  }
  return { segments, entries };
}

describe("readContainer: accepts conforming files", () => {
  it("reads the example and a hand-built copy of it identically", () => {
    const rebuilt = buildContainer([{ objects: exampleObjects(), xrefNumber: 5 }]);
    expect(Buffer.from(rebuilt).equals(Buffer.from(registered))).toBe(true);
    expect(readContainer(rebuilt).revisions).toHaveLength(1);
  });

  it("requires a Uint8Array", () => {
    expect(() => readContainer("not bytes" as never)).toThrow(TypeError);
  });
});

describe("rule: the magic number does not match", () => {
  it("rejects a wrong first byte", () => {
    expect(hasNotaMagic(registered)).toBe(true);
    expectRejected(flip(registered, 0), "BAD_MAGIC");
  });

  it("rejects a file whose high bit was stripped by a 7-bit channel", () => {
    const out = registered.slice();
    out[0] = 0x09;
    expectRejected(out, "BAD_MAGIC");
  });

  it("rejects CRLF-to-LF conversion of the magic", () => {
    // 0D 0A -> 0A removes one byte and shifts the rest.
    const out = concatBytes([registered.subarray(0, 5), registered.subarray(6)]);
    expectRejected(out, "BAD_MAGIC");
  });

  it("rejects an empty file and unrelated bytes", () => {
    expectRejected(new Uint8Array(0), "BAD_MAGIC");
    expectRejected(utf8("%PDF-1.7\n"), "BAD_MAGIC");
  });

  it("identifies a v1.0 JSON document by its first byte", () => {
    const err = expectRejected(utf8('{"version":"1.0"}'), "LEGACY_DOCUMENT");
    expect(err.message).toContain("v1.0");
  });
});

describe("header version and flags", () => {
  it("rejects a major version it does not implement", () => {
    const file = buildContainer([{ objects: exampleObjects(), xrefNumber: 5 }], encodeHeader(1, 2));
    expectRejected(file, "UNSUPPORTED_VERSION");
  });

  it("accepts any minor version", () => {
    const file = buildContainer([{ objects: exampleObjects(), xrefNumber: 5 }], encodeHeader(7));
    expect(readContainer(file).versionMinor).toBe(7);
    expect(readNota(file).versionMinor).toBe(7);
  });

  it("rejects reserved flag bits", () => {
    const file = buildContainer([{ objects: exampleObjects(), xrefNumber: 5 }], encodeHeader(1, 1, 0x01));
    expectRejected(file, "BAD_FLAGS");
  });
});

describe("rule: any CRC does not match", () => {
  it("rejects a bad header CRC", () => {
    expectRejected(flip(registered, 12), "BAD_CRC");
    // A changed header byte with the old CRC is the same failure.
    expectRejected(flip(registered, 10), "BAD_CRC");
  });

  it("rejects a bad object CRC", () => {
    // Corrupt one content byte, then recompute the trailer digest so that the
    // object CRC is the only thing left to catch it.
    const file = resealRevision0(flip(registered, 100));
    const err = expectRejected(file, "BAD_CRC");
    expect(err.message).toContain("CONT");
  });

  it("rejects a bad XREF CRC", () => {
    const xrefCrcOffset = 1457 - 4;
    expectRejected(resealRevision0(flip(registered, xrefCrcOffset)), "BAD_CRC");
  });

  it("rejects a bad trailer CRC", () => {
    expectRejected(flip(registered, 1457 + 52), "BAD_CRC");
    expectRejected(flip(registered, 1457 + 9), "BAD_CRC");
  });
});

describe("rule: any trailer digest or size does not match", () => {
  it("rejects a digest mismatch", () => {
    expectRejected(flip(registered, 100), "BAD_DIGEST");
  });

  it("rejects a digest mismatch in an earlier revision", () => {
    // Change a byte of revision 0 and reseal only revision 1's trailer chain.
    const body = flip(verified, 100);
    const rev1Trailer = 1783;
    const head = body.slice(0, rev1Trailer + 64);
    const resealed = resealRevision0(head, { revision: 1, xrefOffset: 1747, prevTrailer: 1457 });
    expectRejected(resealed, "BAD_DIGEST");
  });

  it("rejects a size mismatch", () => {
    expectRejected(resealRevision0(registered, { size: registered.length + 1 }), "BAD_SIZE");
    expectRejected(resealRevision0(registered, { size: registered.length - 64 }), "BAD_SIZE");
  });
});

describe("rule: any byte belongs to no structure, or two structures overlap", () => {
  it("rejects trailing bytes", () => {
    const err = expectRejected(concatBytes([registered, Uint8Array.of(0x00)]), "TRAILING_DATA");
    expect(err.message).toContain("1 byte(s) follow the final trailer");
    expectRejected(concatBytes([registered, utf8("\n")]), "TRAILING_DATA");
    expectRejected(concatBytes([verified, utf8("<script>")]), "TRAILING_DATA");
  });

  it("rejects a truncated file", () => {
    expectRejected(registered.subarray(0, registered.length - 1), "TRUNCATED");
    expectRejected(registered.subarray(0, 700), "TRUNCATED");
    expectRejected(registered.subarray(0, 16), "TRUNCATED");
    expectRejected(registered.subarray(0, 10), "TRUNCATED");
  });

  it("rejects a gap between objects", () => {
    const { segments, entries } = exampleLayout();
    const pad = new Uint8Array(4);
    const shifted = entries.map((e, i) => (i === 0 ? e : { ...e, offset: e.offset + pad.length }));
    const file = layoutRevision0([segments[0], pad, ...segments.slice(1)], shifted);
    const err = expectRejected(file, "GAP");
    expect(err.message).toContain("4 byte(s) belong to no structure");
  });

  it("rejects padding before the first object", () => {
    const { segments, entries } = exampleLayout();
    const shifted = entries.map((e) => ({ ...e, offset: e.offset + 1 }));
    expectRejected(layoutRevision0([Uint8Array.of(0), ...segments], shifted), "GAP");
  });

  it("rejects padding between the last object and the XREF table", () => {
    const { segments, entries } = exampleLayout();
    expectRejected(layoutRevision0([...segments, new Uint8Array(8)], entries), "GAP");
  });

  it("rejects padding between the XREF table and the trailer", () => {
    const { segments, entries } = exampleLayout();
    expectRejected(layoutRevision0(segments, entries, { afterXref: new Uint8Array(3) }), "GAP");
  });

  it("rejects bytes between a trailer and the next revision", () => {
    const padded = concatBytes([registered, new Uint8Array(5)]);
    const { file } = appendRevision(padded, {
      revision: 1,
      prevTrailer: 1457,
      objects: [stat(6)],
      xrefNumber: 7,
    });
    expectRejected(file, "GAP");
  });

  it("rejects an object hidden from the XREF table", () => {
    // RCPT is present in the bytes but the table does not list it.
    const { segments, entries } = exampleLayout();
    expectRejected(layoutRevision0(segments, entries.slice(0, 3)), "GAP");
  });

  it("rejects overlapping structures", () => {
    // Two table entries claim the same bytes.
    const { segments, entries } = exampleLayout();
    const doubled = [entries[0], entries[0], ...entries.slice(1)];
    expectRejected(layoutRevision0(segments, doubled), "OVERLAP");
  });

  it("rejects an object that runs into the XREF table", () => {
    const { segments, entries } = exampleLayout();
    const last = entries[3];
    const stretched = [...entries.slice(0, 3), { ...last, length: last.length + 40 }];
    expectRejected(layoutRevision0(segments, stretched), "OVERLAP");
  });
});

describe("rule: object numbers are duplicated or out of order", () => {
  it("rejects a reused object number in an annex", () => {
    // An annex that tries to redefine object #4, the receipt's number.
    const err = expectRejected(withAnnex([stat(4)], 7), "BAD_OBJECT_NUMBER");
    expect(err.message).toContain("duplicated or out of order");
  });

  it("rejects an annex XREF that reuses a number", () => {
    expectRejected(withAnnex([stat(6)], 5), "BAD_OBJECT_NUMBER");
    expectRejected(withAnnex([stat(6)], 6), "BAD_OBJECT_NUMBER");
  });

  it("rejects object numbers out of order", () => {
    expectRejected(withAnnex([stat(7), stat(6)], 8), "BAD_OBJECT_NUMBER");
  });

  it("rejects numbers that do not continue from the highest in the file", () => {
    expectRejected(withAnnex([stat(9)], 10), "BAD_OBJECT_NUMBER");
    expectRejected(withAnnex([stat(6)], 9), "BAD_OBJECT_NUMBER");
  });

  it("rejects a reused number across annexes", () => {
    const file = buildContainer([
      { objects: exampleObjects(), xrefNumber: 5 },
      { objects: [stat(6)], xrefNumber: 7 },
      { objects: [stat(7)], xrefNumber: 8 },
    ]);
    expectRejected(file, "BAD_OBJECT_NUMBER");
  });

  it("rejects the wrong fixed numbers in revision 0", () => {
    const renumbered = exampleObjects().map((o) => ({ ...o, number: o.number + 1 }));
    expectRejected(buildContainer([{ objects: renumbered, xrefNumber: 6 }]), "BAD_OBJECT_NUMBER");
    expectRejected(buildContainer([{ objects: exampleObjects(), xrefNumber: 6 }]), "BAD_OBJECT_NUMBER");
  });

  it("leaves number 2 unused when there is no metadata", () => {
    const noMeta = exampleObjects().filter((o) => o.type !== "META");
    // Structurally valid: CONT #1, SIGN #3, RCPT #4, XREF #5.
    expect(readContainer(buildContainer([{ objects: noMeta, xrefNumber: 5 }])).revisions[0].objects).toHaveLength(3);
    // Closing the gap is not.
    const closed = noMeta.map((o, i) => ({ ...o, number: i + 1 }));
    expectRejected(buildContainer([{ objects: closed, xrefNumber: 4 }]), "BAD_OBJECT_NUMBER");
  });
});

describe("rule: an XREF entry disagrees with the object it points to", () => {
  it.each([
    ["number", (e: XrefEntry): XrefEntry => ({ ...e, number: e.number + 10 })],
    ["type", (e: XrefEntry): XrefEntry => ({ ...e, type: "SIGN" })],
    ["length", (e: XrefEntry): XrefEntry => ({ ...e, length: e.length - 1 })],
  ])("rejects an entry with the wrong %s", (_name, mutate) => {
    const { segments, entries } = exampleLayout();
    const wrong = [...entries.slice(0, 3), mutate(entries[3])];
    expectRejected(layoutRevision0(segments, wrong), "XREF_MISMATCH");
  });

  it("rejects an xrefOffset that does not point at an XREF object", () => {
    expectRejected(resealRevision0(registered, { xrefOffset: 931 }), "XREF_MISMATCH");
  });

  it("rejects an xrefOffset outside the revision", () => {
    expectRejected(resealRevision0(registered, { xrefOffset: 4 }), "BAD_TRAILER");
    expectRejected(resealRevision0(registered, { xrefOffset: 60000 }), "BAD_TRAILER");
  });
});

describe("rule: a critical object type is unknown", () => {
  it("rejects an unknown critical type in an annex", () => {
    const err = expectRejected(
      withAnnex([{ type: "ZAPP", number: 6, payload: utf8("{}") }]),
      "UNKNOWN_CRITICAL_TYPE"
    );
    expect(err.message).toContain("ZAPP");
  });

  it("rejects an unknown critical type in revision 0", () => {
    const objects = [...exampleObjects(), { type: "ZAPP", number: 5, payload: utf8("{}") }];
    expectRejected(buildContainer([{ objects, xrefNumber: 6 }]), "UNKNOWN_CRITICAL_TYPE");
  });

  it("rejects SOCL, which v1.1 does not define, wherever it appears", () => {
    // An earlier draft of v1.1 had a SOCL annex object. It was removed, so
    // SOCL is an unknown critical type like any other.
    const socl = {
      asOfBlock: 7660000,
      asOfTime: 1795650000,
      sociallyVerified: true,
      endorsements: 5,
      verifiedEndorsements: 3,
      accounts: [{ platform: "dns", handle: "example.com", confirmedAt: 1795600000 }],
    };
    const inAnnex = withAnnex([{ type: "SOCL", number: 6, payload: jsonPayload(socl) }]);
    expect(expectRejected(inAnnex, "UNKNOWN_CRITICAL_TYPE").message).toContain("SOCL");
    expectRejected(withAnnex([stat(6), { type: "SOCL", number: 7, payload: jsonPayload(socl) }]), "UNKNOWN_CRITICAL_TYPE");
    const inBody = [...exampleObjects(), { type: "SOCL", number: 5, payload: jsonPayload(socl) }];
    expectRejected(buildContainer([{ objects: inBody, xrefNumber: 6 }]), "UNKNOWN_CRITICAL_TYPE");
  });

  it("accepts an annex that carries only STAT objects", () => {
    const container = readContainer(withAnnex([stat(6), stat(7)]));
    expect(container.revisions[1].objects.map((o) => o.type)).toEqual(["STAT", "STAT"]);
  });

  it.each(["VIEW", "ATCH"])("rejects the reserved type %s", (type) => {
    const err = expectRejected(withAnnex([{ type, number: 6, payload: utf8("{}") }]), "UNKNOWN_CRITICAL_TYPE");
    expect(err.message).toContain("reserved");
  });

  it("ignores an unknown ancillary type in an annex", () => {
    const file = withAnnex([
      { type: "note", number: 6, payload: utf8("not json, not inspected") },
      stat(7),
    ]);
    const container = readContainer(file);
    expect(container.revisions[1].objects[0]).toMatchObject({
      type: "note",
      critical: false,
      recognized: false,
    });
    const nota = readNota(file);
    expect(nota.annexObjects.map((o) => o.type)).toEqual(["STAT"]);
  });

  it("still checks the CRC and numbering of an ancillary object it ignores", () => {
    expectRejected(withAnnex([{ type: "note", number: 9, payload: utf8("x") }]), "BAD_OBJECT_NUMBER");
  });

  it("rejects a type that is not four ASCII letters", () => {
    expectRejected(withAnnex([{ type: "ST4T", number: 6, payload: utf8("{}") }]), "BAD_OBJECT_TYPE");
    expectRejected(withAnnex([{ type: "ST T", number: 6, payload: utf8("{}") }]), "BAD_OBJECT_TYPE");
  });
});

describe("rule: an object appears in a revision it is not permitted in", () => {
  it("rejects a content object in an annex", () => {
    // The shadow attack: a later revision that tries to supply new content.
    const forged = jsonPayload({ ...exampleContent(), resource: { ...exampleContent().resource, name: "Attacker" } });
    const err = expectRejected(withAnnex([{ type: "CONT", number: 6, payload: forged }]), "MISPLACED_OBJECT");
    expect(err.message).toContain("CONT must not appear in an annex");
  });

  it.each(["META", "SIGN", "RCPT"])("rejects %s in an annex", (type) => {
    const original = exampleObjects().find((o) => o.type === type)!;
    expectRejected(withAnnex([{ ...original, number: 6 }]), "MISPLACED_OBJECT");
  });

  it("rejects STAT in revision 0", () => {
    const objects = [...exampleObjects(), stat(5)];
    expectRejected(buildContainer([{ objects, xrefNumber: 6 }]), "MISPLACED_OBJECT");
  });

  it("rejects an ancillary object in revision 0", () => {
    const objects = [...exampleObjects(), { type: "note", number: 5, payload: utf8("x") }];
    expectRejected(buildContainer([{ objects, xrefNumber: 6 }]), "MISPLACED_OBJECT");
  });

  it("rejects revision 0 objects out of order", () => {
    const [cont, meta, sign, rcpt] = exampleObjects();
    expectRejected(buildContainer([{ objects: [cont, meta, rcpt, sign], xrefNumber: 5 }]), "BAD_OBJECT_ORDER");
    expectRejected(buildContainer([{ objects: [meta, cont, sign, rcpt], xrefNumber: 5 }]), "BAD_OBJECT_ORDER");
  });
});

describe("rule: a required object is missing or duplicated", () => {
  it.each(["CONT", "SIGN", "RCPT"])("rejects a file with no %s", (type) => {
    const err = expectRejected(mintedBodyWith({ [type]: null }), "MISSING_OBJECT");
    expect(err.message).toContain(type);
  });

  it("rejects a draft: content with no receipt is not a .nota file", () => {
    const [cont, , sign] = exampleObjects();
    expectRejected(buildContainer([{ objects: [cont, sign], xrefNumber: 5 }]), "MISSING_OBJECT");
  });

  it.each(["CONT", "META", "SIGN", "RCPT"])("rejects a duplicated %s", (type) => {
    const objects = exampleObjects();
    const dup = objects.find((o) => o.type === type)!;
    expectRejected(
      buildContainer([{ objects: [...objects, { ...dup, number: 5 }], xrefNumber: 6 }]),
      "DUPLICATE_OBJECT"
    );
  });

  it("rejects an XREF object listed in an XREF table", () => {
    const inner = encodeObject("XREF", 6, Uint8Array.of(0, 0, 0, 0)).subarray(12, 16);
    expectRejected(withAnnex([{ type: "XREF", number: 6, payload: inner }]), "DUPLICATE_OBJECT");
  });

  it("rejects an annex that carries no objects", () => {
    expectRejected(withAnnex([], 6), "EMPTY_ANNEX");
  });
});

describe("trailer chain", () => {
  it("rejects revision numbers that do not increase by 1", () => {
    const file = buildContainer([
      { objects: exampleObjects(), xrefNumber: 5 },
      { objects: [stat(6)], xrefNumber: 7, revision: 2 },
    ]);
    expectRejected(file, "BAD_TRAILER");
  });

  it("rejects a first revision that is not revision 0", () => {
    expectRejected(buildContainer([{ objects: exampleObjects(), xrefNumber: 5, revision: 1 }]), "BAD_TRAILER");
  });

  it("rejects a non-zero prevTrailer in revision 0", () => {
    expectRejected(resealRevision0(registered, { prevTrailer: 16 }), "BAD_TRAILER");
  });

  it("rejects a prevTrailer that does not point at a trailer", () => {
    const { file } = appendRevision(registered, {
      revision: 1,
      prevTrailer: 1400,
      objects: [stat(6)],
      xrefNumber: 7,
    });
    expectRejected(file, "BAD_TRAILER");
  });
});

describe("rule: a JSON payload is not canonical JSON", () => {
  const content = exampleContent();
  const canonical = canonicalize(content);

  it.each([
    ["insignificant whitespace", canonical.replace('{"chain":', '{ "chain":')],
    ["pretty-printed JSON", JSON.stringify(content, null, 2)],
    ["unsorted members", JSON.stringify(content)],
    ["a duplicate member", canonical.replace('"version":"1.1"}', '"version":"1.0","version":"1.1"}')],
    ["a non-shortest number", canonical.replace('"chainId":1,', '"chainId":1.0,')],
    ["an exponent number", canonical.replace('"expiresAt":0,', '"expiresAt":0e0,')],
    ["an unnecessary escape", canonical.replace("Example Labs", "\\u0045xample Labs")],
    ["an escaped solidus", canonical.replace("Example Labs", "Example\\/Labs")],
    ["a byte order mark", "﻿" + canonical],
    ["a trailing newline", canonical + "\n"],
    ["text that is not JSON", canonical.slice(0, -1)],
  ])("rejects %s", (_name, text) => {
    expect(text).not.toBe(canonical);
    expectRejected(mintedBodyWith({ CONT: utf8(text) }), "NON_CANONICAL_JSON");
  });

  it("applies to every JSON object type, including annex objects", () => {
    const loose = utf8(JSON.stringify(exampleStatus(), null, 1));
    expectRejected(withAnnex([{ type: "STAT", number: 6, payload: loose }]), "NON_CANONICAL_JSON");
    expectRejected(mintedBodyWith({ META: utf8('{"tags": ["treasury"]}') }), "NON_CANONICAL_JSON");
    expectRejected(mintedBodyWith({ SIGN: utf8('{"signer":"x","scheme":"y"}') }), "NON_CANONICAL_JSON");
  });

  it("rejects a payload that is canonical JSON but not an object", () => {
    expectRejected(mintedBodyWith({ META: utf8('["treasury"]') }), "BAD_PAYLOAD");
    expectRejected(mintedBodyWith({ META: utf8('"treasury"') }), "BAD_PAYLOAD");
    expectRejected(mintedBodyWith({ META: utf8("null") }), "BAD_PAYLOAD");
  });

  it("rejects an empty JSON payload", () => {
    expectRejected(mintedBodyWith({ META: new Uint8Array(0) }), "NON_CANONICAL_JSON");
  });
});

describe("rule: a JSON payload violates the Content Safety Rules", () => {
  it("rejects a bidirectional override in the content", () => {
    const content = exampleContent();
    content.resource.name = "Example ‮yrusaert";
    const err = expectRejected(mintedBodyWith({ CONT: jsonPayload(content) }), "CONTENT_SAFETY");
    expect(err.rule).toBe("T3");
  });

  it("rejects a control character carried in escaped form", () => {
    // "a\nb" is canonical JSON for a string holding U+000A, which T2 refuses.
    const err = expectRejected(mintedBodyWith({ META: jsonPayload({ note: "line one\nline two" }) }), "CONTENT_SAFETY");
    expect(err.rule).toBe("T2");
  });

  it("rejects malformed UTF-8", () => {
    const good = jsonPayload({ note: "ab" });
    const bad = good.slice();
    bad[bad.indexOf(0x61)] = 0xc0; // 'a' -> an overlong lead byte
    const err = expectRejected(mintedBodyWith({ META: bad }), "CONTENT_SAFETY");
    expect(err.rule).toBe("T1");
  });

  it("applies to member names as well as values", () => {
    const err = expectRejected(mintedBodyWith({ META: jsonPayload({ ["ta​gs"]: 1 }) }), "CONTENT_SAFETY");
    expect(err.rule).toBe("T4");
  });
});

describe("rule: the file exceeds the size limits", () => {
  it("rejects a file over 65,536 bytes", () => {
    // Structurally valid in every other respect: an ignorable annex object makes it too large.
    const big = { type: "note", number: 6, payload: new Uint8Array(65_536) };
    const file = withAnnex([big]);
    expect(file.length).toBeGreaterThan(65_536);
    const err = expectRejected(file, "SIZE_LIMIT");
    expect(err.message).toContain("65536");
  });

  it("accepts a file of exactly 65,536 bytes", () => {
    const overhead = withAnnex([{ type: "note", number: 6, payload: new Uint8Array(0) }]).length;
    const file = withAnnex([{ type: "note", number: 6, payload: new Uint8Array(65_536 - overhead) }]);
    expect(file.length).toBe(65_536);
    expect(readContainer(file).size).toBe(65_536);
    expectRejected(withAnnex([{ type: "note", number: 6, payload: new Uint8Array(65_537 - overhead) }]), "SIZE_LIMIT");
  });

  it("rejects a CONT payload over 4,096 bytes", () => {
    const content = { ...exampleContent(), padding: "x".repeat(4096) };
    const err = expectRejected(mintedBodyWith({ CONT: jsonPayload(content) }), "SIZE_LIMIT");
    expect(err.message).toContain("CONT");
  });

  it("rejects a META payload over 32,768 bytes", () => {
    const meta = jsonPayload({ blob: "x".repeat(32_768) });
    const err = expectRejected(mintedBodyWith({ META: meta }), "SIZE_LIMIT");
    expect(err.message).toContain("META");
    // 32,768 bytes exactly is within the limit.
    const edge = jsonPayload({ blob: "x".repeat(32_768 - '{"blob":""}'.length) });
    expect(edge.length).toBe(32_768);
    expect(() => readContainer(mintedBodyWith({ META: edge }))).not.toThrow();
  });

  it("rejects JSON nested deeper than 8", () => {
    const nest = (depth: number): string => "{\"a\":".repeat(depth - 1) + "{}" + "}".repeat(depth - 1);
    expect(() => readContainer(mintedBodyWith({ META: utf8(nest(8)) }))).not.toThrow();
    expectRejected(mintedBodyWith({ META: utf8(nest(9)) }), "SIZE_LIMIT");
    expectRejected(mintedBodyWith({ META: utf8('{"a":[[[[[[[[1]]]]]]]]}') }), "SIZE_LIMIT");
    // Hostile nesting is refused without a recursive parse.
    expectRejected(mintedBodyWith({ META: utf8("[".repeat(20_000) + "]".repeat(20_000)) }), "SIZE_LIMIT");
  });
});

describe("no lenient mode", () => {
  it("rejects every single-byte corruption of the example", () => {
    // Flip one bit in each byte in turn. No corrupted file may be accepted.
    for (let i = 0; i < registered.length; i++) {
      const corrupted = flip(registered, i);
      expect(() => readContainer(corrupted), `byte ${i}`).toThrow(NotaContainerError);
    }
  });

  it("rejects every truncation of the annexed example", () => {
    for (let n = 0; n < verified.length; n++) {
      if (n === 1521) continue; // revision 0 alone is itself a complete file
      expect(() => readContainer(verified.subarray(0, n)), `length ${n}`).toThrow(NotaContainerError);
    }
  });
});
