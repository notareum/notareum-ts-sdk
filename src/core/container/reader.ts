/**
 * Strict reader for the v1.1 `.nota` container.
 *
 * The reader locates the final trailer, follows `prevTrailer` back to
 * revision 0, and then accounts for every byte of every revision through its
 * `XREF` table. It enforces each rejection rule of "Reading a File"
 * (protocol/v1.1/01-nota-format.md). There is no lenient mode: the first
 * deviation throws, and nothing is repaired or partially loaded.
 */

import { keccak256 } from "ethers";
import {
  NOTA_CONTAINER_VERSION_MAJOR,
  NOTA_EOF_MARK,
  NOTA_HEADER_BYTES,
  NOTA_MAGIC,
  NOTA_MAX_CONTENT_BYTES,
  NOTA_MAX_FILE_BYTES,
  NOTA_MAX_JSON_DEPTH,
  NOTA_MAX_METADATA_BYTES,
  NOTA_OBJECT_OVERHEAD_BYTES,
  NOTA_TRAILER_BYTES,
  NOTA_TRAILER_TAG,
} from "../constants.js";
import { CanonicalJsonError, NotaContainerError } from "../errors.js";
import type { NotaContainerErrorCode } from "../errors.js";
import { parseCanonicalJsonText } from "../json/canonical.js";
import type { JsonObject } from "../json/canonical.js";
import { findTextSafetyViolation } from "../nota/safety.js";
import { Utf8Error, decodeUtf8 } from "../utf8.js";
import { asciiBytes, bytesMatch, bytesToHex, latin1String, readU32be } from "./bytes.js";
import { crc32 } from "./crc32.js";
import {
  NOTA_JSON_OBJECT_TYPES,
  NOTA_MINTED_BODY_NUMBERS,
  NOTA_RESERVED_OBJECT_TYPES,
} from "./types.js";
import type { Container, ContainerObject, ContainerRevision } from "./types.js";

const HEADER = NOTA_HEADER_BYTES;
const TRAILER = NOTA_TRAILER_BYTES;
const FRAME = NOTA_OBJECT_OVERHEAD_BYTES;
/** Smallest possible XREF object: framing plus a 4-byte count. */
const MIN_XREF = FRAME + 4;

const TRAILER_TAG = asciiBytes(NOTA_TRAILER_TAG);
const EOF_MARK = asciiBytes(NOTA_EOF_MARK);

const MINTED_BODY_TYPES: readonly string[] = ["CONT", "META", "SIGN", "RCPT"];
/** The only object type an annex may carry in v1.1, besides its `XREF`. */
const ANNEX_TYPES: readonly string[] = ["STAT"];

function fail(
  code: NotaContainerErrorCode,
  message: string,
  detail: { offset?: number; rule?: string } = {}
): never {
  throw new NotaContainerError(code, message, detail);
}

interface RawTrailer {
  offset: number;
  revision: number;
  xrefOffset: number;
  prevTrailer: number;
  size: number;
  digest: string;
}

/** True when the bytes start with the `.nota` magic number. Checks nothing else. */
export function hasNotaMagic(bytes: Uint8Array): boolean {
  return bytesMatch(bytes, 0, NOTA_MAGIC);
}

/**
 * Reads a `.nota` container strictly.
 *
 * Enforced here: magic number, header CRC, version and flags; every trailer's
 * tag, CRC, `size`, `digest`, revision number and back-pointer; every object's
 * CRC and its agreement with its `XREF` entry; that every byte of the file
 * belongs to exactly one structure; object numbering; which object types may
 * appear in which revision; required and duplicated objects; canonical JSON
 * and Content Safety Rules T1 through T6 for every JSON payload; and the size
 * limits.
 *
 * Not enforced here: the schema of each payload, the signature, and the
 * consistency of the receipt with the content. Use `readNota` for a complete
 * read; this function is its first step.
 *
 * @throws NotaContainerError on the first violation.
 */
export function readContainer(file: Uint8Array): Container {
  if (!(file instanceof Uint8Array)) {
    throw new TypeError("readContainer expects a Uint8Array");
  }
  const n = file.length;

  // --- Header -------------------------------------------------------------
  if (n > 0 && file[0] === 0x7b) {
    fail(
      "LEGACY_DOCUMENT",
      "the file starts with '{': it is a v1.0 JSON document, not a v1.1 container",
      { offset: 0 }
    );
  }
  if (!hasNotaMagic(file)) {
    fail("BAD_MAGIC", "the magic number does not match", { offset: 0 });
  }
  if (n > NOTA_MAX_FILE_BYTES) {
    fail("SIZE_LIMIT", `the file is ${n} bytes; the limit is ${NOTA_MAX_FILE_BYTES}`);
  }
  if (n < HEADER) {
    fail("TRUNCATED", "the file ends inside the header");
  }
  const versionMajor = file[9];
  const versionMinor = file[10];
  const flags = file[11];
  if (versionMajor !== NOTA_CONTAINER_VERSION_MAJOR) {
    fail("UNSUPPORTED_VERSION", `container major version ${versionMajor} is not implemented`, {
      offset: 9,
    });
  }
  if (readU32be(file, 12) !== crc32(file.subarray(0, 12))) {
    fail("BAD_CRC", "header CRC does not match", { offset: 12 });
  }
  if (flags !== 0) {
    fail("BAD_FLAGS", "reserved header flag bits are set", { offset: 11 });
  }
  if (n < HEADER + MIN_XREF + TRAILER) {
    fail("TRUNCATED", "the file is too short to hold a revision");
  }

  // --- Trailers, from the end of the file backwards -------------------------
  const trailers: RawTrailer[] = [];
  let end = n;
  let expectedRevision: number | null = null;
  for (;;) {
    const t = end - TRAILER;
    const isFinal = trailers.length === 0;
    if (t < HEADER + MIN_XREF) {
      fail("BAD_TRAILER", "a trailer lies too close to the start of the file", { offset: t });
    }
    if (!bytesMatch(file, t, TRAILER_TAG) || !bytesMatch(file, t + 56, EOF_MARK)) {
      if (isFinal) failNoFinalTrailer(file);
      fail("BAD_TRAILER", "prevTrailer does not point at a trailer", { offset: t });
    }
    if (readU32be(file, t + 52) !== crc32(file.subarray(t, t + 52))) {
      fail("BAD_CRC", "trailer CRC does not match", { offset: t + 52 });
    }
    const revision = readU32be(file, t + 4);
    const xrefOffset = readU32be(file, t + 8);
    const prevTrailer = readU32be(file, t + 12);
    const size = readU32be(file, t + 16);
    if (size !== end) {
      fail("BAD_SIZE", `trailer size is ${size}; the revision ends at ${end}`, { offset: t + 16 });
    }
    if (expectedRevision !== null && revision !== expectedRevision) {
      fail(
        "BAD_TRAILER",
        `revision numbers must increase by 1: found ${revision} before ${expectedRevision + 1}`,
        { offset: t + 4 }
      );
    }
    const digest = bytesToHex(file.subarray(t + 20, t + 52));
    if (digest !== keccak256(file.subarray(0, t))) {
      fail("BAD_DIGEST", `trailer digest of revision ${revision} does not match`, {
        offset: t + 20,
      });
    }
    trailers.unshift({ offset: t, revision, xrefOffset, prevTrailer, size, digest });
    if (revision === 0) {
      if (prevTrailer !== 0) {
        fail("BAD_TRAILER", "prevTrailer must be 0 in revision 0", { offset: t + 12 });
      }
      break;
    }
    if (prevTrailer < HEADER + MIN_XREF || prevTrailer + TRAILER + MIN_XREF > t) {
      fail("BAD_TRAILER", `prevTrailer ${prevTrailer} is out of range`, { offset: t + 12 });
    }
    expectedRevision = revision - 1;
    end = prevTrailer + TRAILER;
  }

  // --- Objects, revision by revision ----------------------------------------
  const revisions: ContainerRevision[] = [];
  let lastNumber = 0;
  for (let r = 0; r < trailers.length; r++) {
    const trailer = trailers[r];
    const start = r === 0 ? HEADER : trailers[r - 1].offset + TRAILER;
    const t = trailer.offset;
    const x = trailer.xrefOffset;

    if (x < start || x + MIN_XREF > t) {
      fail("BAD_TRAILER", `xrefOffset ${x} of revision ${r} is out of range`, { offset: t + 8 });
    }
    if (latin1String(file, x, 4) !== "XREF") {
      fail("XREF_MISMATCH", `xrefOffset of revision ${r} does not point at an XREF object`, {
        offset: x,
      });
    }
    const xrefNumber = readU32be(file, x + 4);
    const xrefLength = readU32be(file, x + 8);
    const xrefEnd = x + FRAME + xrefLength;
    if (xrefEnd < t) {
      fail("GAP", `${t - xrefEnd} byte(s) between the XREF object and the trailer`, {
        offset: xrefEnd,
      });
    }
    if (xrefEnd > t) {
      fail("OVERLAP", `the XREF object of revision ${r} runs into the trailer`, { offset: x });
    }
    if (readU32be(file, xrefEnd - 4) !== crc32(file.subarray(x, xrefEnd - 4))) {
      fail("BAD_CRC", `CRC of the XREF object of revision ${r} does not match`, {
        offset: xrefEnd - 4,
      });
    }
    const count = readU32be(file, x + 12);
    if (xrefLength !== 4 + 16 * count) {
      fail("XREF_MISMATCH", `XREF payload length ${xrefLength} does not fit ${count} entries`, {
        offset: x,
      });
    }

    const objects: ContainerObject[] = [];
    let cursor = start;
    for (let i = 0; i < count; i++) {
      const e = x + 16 + i * 16;
      const type = latin1String(file, e, 4);
      const number = readU32be(file, e + 4);
      const offset = readU32be(file, e + 8);
      const length = readU32be(file, e + 12);
      if (offset > cursor) {
        fail("GAP", `${offset - cursor} byte(s) belong to no structure`, { offset: cursor });
      }
      if (offset < cursor) {
        fail("OVERLAP", `XREF entry ${i} of revision ${r} overlaps an earlier structure`, {
          offset,
        });
      }
      const objectEnd = offset + FRAME + length;
      if (objectEnd > x) {
        fail("OVERLAP", `object ${type} #${number} runs into the XREF object`, { offset });
      }
      if (
        !bytesMatch(file, offset, file.subarray(e, e + 4)) ||
        readU32be(file, offset + 4) !== number ||
        readU32be(file, offset + 8) !== length
      ) {
        fail("XREF_MISMATCH", `XREF entry ${i} of revision ${r} disagrees with its object`, {
          offset,
        });
      }
      if (readU32be(file, objectEnd - 4) !== crc32(file.subarray(offset, objectEnd - 4))) {
        fail("BAD_CRC", `CRC of object ${type} #${number} does not match`, {
          offset: objectEnd - 4,
        });
      }
      if (!/^[A-Za-z]{4}$/.test(type)) {
        fail("BAD_OBJECT_TYPE", "an object type must be four ASCII letters", { offset });
      }
      const critical = type.charCodeAt(0) < 0x61; // uppercase first letter
      objects.push({
        type,
        number,
        revision: r,
        offset,
        length,
        payload: file.subarray(offset + 12, offset + 12 + length),
        critical,
        recognized: critical,
      });
      cursor = objectEnd;
    }
    if (cursor < x) {
      fail("GAP", `${x - cursor} byte(s) between the last object and the XREF object`, {
        offset: cursor,
      });
    }

    if (r === 0) {
      checkMintedBody(objects, xrefNumber);
    } else {
      checkAnnex(objects, xrefNumber, r, lastNumber);
    }
    lastNumber = xrefNumber;

    for (const o of objects) {
      if (NOTA_JSON_OBJECT_TYPES.includes(o.type)) o.json = readJsonPayload(o);
    }

    revisions.push({
      revision: r,
      offset: start,
      objects,
      xrefOffset: x,
      xrefNumber,
      trailerOffset: t,
      prevTrailer: trailer.prevTrailer,
      size: trailer.size,
      digest: trailer.digest,
    });
  }

  return { versionMajor, versionMinor, flags, revisions, size: n };
}

/** The last 64 bytes are not a trailer: tell trailing data from truncation, then reject. */
function failNoFinalTrailer(file: Uint8Array): never {
  const n = file.length;
  for (let p = n - EOF_MARK.length - 1; p >= HEADER + MIN_XREF + 56; p--) {
    if (!bytesMatch(file, p, EOF_MARK)) continue;
    const t = p - 56;
    if (
      bytesMatch(file, t, TRAILER_TAG) &&
      readU32be(file, t + 52) === crc32(file.subarray(t, t + 52)) &&
      readU32be(file, t + 16) === p + EOF_MARK.length
    ) {
      fail("TRAILING_DATA", `${n - (p + EOF_MARK.length)} byte(s) follow the final trailer`, {
        offset: p + EOF_MARK.length,
      });
    }
  }
  fail("TRUNCATED", "the file does not end with a trailer");
}

function describeType(type: string): string {
  return NOTA_RESERVED_OBJECT_TYPES.includes(type)
    ? `object type ${type} is reserved and must not appear in a v1.1 file`
    : `unknown critical object type ${type}`;
}

/** Revision 0: `CONT` #1, `META` #2 (optional), `SIGN` #3, `RCPT` #4, `XREF` #5, in that order. */
function checkMintedBody(objects: ContainerObject[], xrefNumber: number): void {
  const counts = new Map<string, number>();
  for (const o of objects) {
    if (!o.critical) {
      fail("MISPLACED_OBJECT", `ancillary object ${o.type} must not appear in revision 0`, {
        offset: o.offset,
      });
    }
    if (ANNEX_TYPES.includes(o.type)) {
      fail("MISPLACED_OBJECT", `${o.type} is permitted only in annex revisions`, {
        offset: o.offset,
      });
    }
    if (o.type === "XREF") {
      fail("DUPLICATE_OBJECT", "a revision has exactly one XREF object, which does not list itself", {
        offset: o.offset,
      });
    }
    if (!MINTED_BODY_TYPES.includes(o.type)) {
      fail("UNKNOWN_CRITICAL_TYPE", describeType(o.type), { offset: o.offset });
    }
    counts.set(o.type, (counts.get(o.type) ?? 0) + 1);
  }
  for (const type of MINTED_BODY_TYPES) {
    const count = counts.get(type) ?? 0;
    if (count > 1) fail("DUPLICATE_OBJECT", `revision 0 holds ${count} ${type} objects`);
    if (count === 0 && type !== "META") {
      fail("MISSING_OBJECT", `revision 0 has no ${type} object`);
    }
  }
  const expectedOrder = MINTED_BODY_TYPES.filter((type) => counts.has(type));
  for (let i = 0; i < objects.length; i++) {
    if (objects[i].type !== expectedOrder[i]) {
      fail("BAD_OBJECT_ORDER", "revision 0 must hold CONT, META (if present), SIGN, RCPT in that order", {
        offset: objects[i].offset,
      });
    }
  }
  for (const o of objects) {
    const required = NOTA_MINTED_BODY_NUMBERS[o.type as keyof typeof NOTA_MINTED_BODY_NUMBERS];
    if (o.number !== required) {
      fail("BAD_OBJECT_NUMBER", `${o.type} must be object #${required}, found #${o.number}`, {
        offset: o.offset,
      });
    }
  }
  if (xrefNumber !== NOTA_MINTED_BODY_NUMBERS.XREF) {
    fail(
      "BAD_OBJECT_NUMBER",
      `the XREF object of revision 0 must be #${NOTA_MINTED_BODY_NUMBERS.XREF}, found #${xrefNumber}`
    );
  }
}

/** Annex: `STAT` and ancillary objects only, numbered on from the highest number in the file. */
function checkAnnex(
  objects: ContainerObject[],
  xrefNumber: number,
  revision: number,
  highestNumber: number
): void {
  if (objects.length === 0) {
    fail("EMPTY_ANNEX", `annex revision ${revision} carries no objects`);
  }
  let last = highestNumber;
  const checkNumber = (label: string, number: number, offset?: number): void => {
    if (number <= last) {
      fail("BAD_OBJECT_NUMBER", `${label} #${number} is duplicated or out of order`, { offset });
    }
    if (number !== last + 1) {
      fail(
        "BAD_OBJECT_NUMBER",
        `${label} #${number} does not continue from the highest object number, ${last}`,
        { offset }
      );
    }
    last = number;
  };
  for (const o of objects) {
    if (MINTED_BODY_TYPES.includes(o.type)) {
      fail("MISPLACED_OBJECT", `${o.type} must not appear in an annex (revision ${revision})`, {
        offset: o.offset,
      });
    }
    if (o.type === "XREF") {
      fail("DUPLICATE_OBJECT", "a revision has exactly one XREF object, which does not list itself", {
        offset: o.offset,
      });
    }
    if (o.critical && !ANNEX_TYPES.includes(o.type)) {
      fail("UNKNOWN_CRITICAL_TYPE", describeType(o.type), { offset: o.offset });
    }
    // v1.1 defines no ancillary types, so every ancillary object is unrecognized and ignored.
    checkNumber(`object ${o.type}`, o.number, o.offset);
  }
  checkNumber(`the XREF object of revision ${revision}`, xrefNumber);
}

/** Canonical JSON, Content Safety Rules and size limits for one JSON payload. */
function readJsonPayload(o: ContainerObject): JsonObject {
  const label = `${o.type} #${o.number}`;
  const payloadOffset = o.offset + 12;
  if (o.type === "CONT" && o.length > NOTA_MAX_CONTENT_BYTES) {
    fail("SIZE_LIMIT", `CONT payload is ${o.length} bytes; the limit is ${NOTA_MAX_CONTENT_BYTES}`, {
      offset: o.offset,
    });
  }
  if (o.type === "META" && o.length > NOTA_MAX_METADATA_BYTES) {
    fail("SIZE_LIMIT", `META payload is ${o.length} bytes; the limit is ${NOTA_MAX_METADATA_BYTES}`, {
      offset: o.offset,
    });
  }

  let text: string;
  try {
    text = decodeUtf8(o.payload);
  } catch (err) {
    if (err instanceof Utf8Error) {
      fail("CONTENT_SAFETY", `${label}: T1, malformed UTF-8: ${err.message}`, {
        offset: payloadOffset + err.index,
        rule: "T1",
      });
    }
    throw err;
  }

  let value;
  try {
    value = parseCanonicalJsonText(text, { maxDepth: NOTA_MAX_JSON_DEPTH });
  } catch (err) {
    if (err instanceof CanonicalJsonError) {
      if (err.reason === "depth") {
        fail("SIZE_LIMIT", `${label}: JSON ${err.message}`, { offset: payloadOffset });
      }
      fail("NON_CANONICAL_JSON", `${label}: ${err.message}`, { offset: payloadOffset });
    }
    throw err;
  }

  const violation = findTextSafetyViolation(text);
  if (violation !== null) {
    fail("CONTENT_SAFETY", `${label}: ${violation.rule}, ${violation.message}`, {
      offset: payloadOffset,
      rule: violation.rule,
    });
  }
  // Canonical JSON escapes only '"', '\' and control characters. Any other
  // escape was already refused as non-canonical, so what remains here is an
  // escaped control character: a T2 violation in escaped form.
  const escape = findControlEscape(text);
  if (escape >= 0) {
    fail("CONTENT_SAFETY", `${label}: T2, escaped control character at character ${escape}`, {
      offset: payloadOffset,
      rule: "T2",
    });
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("BAD_PAYLOAD", `${label}: the payload must be a JSON object`, { offset: payloadOffset });
  }
  return value;
}

/**
 * Index of the first backslash inside a JSON string that is followed by
 * anything other than `"` or `\`, or -1. The text must already be valid JSON.
 */
export function findControlEscape(text: string): number {
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (!inString) {
      if (c === 0x22) inString = true;
      continue;
    }
    if (c === 0x22) {
      inString = false;
    } else if (c === 0x5c) {
      const next = text.charCodeAt(i + 1);
      if (next !== 0x22 && next !== 0x5c) return i;
      i++;
    }
  }
  return -1;
}
