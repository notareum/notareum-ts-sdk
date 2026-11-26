/**
 * Low-level container encoders: header, object framing, `XREF` and trailer.
 *
 * These functions encode exactly what they are given and check nothing beyond
 * field widths. They exist so that the checked writers in `nota/file.ts`, and
 * conformance tests that need deliberately malformed files, share one
 * encoder. To produce a `.nota` file use `writeNota`, `appendAnnex` or
 * `reconstructFromMintEvent`, which verify their output with the strict reader.
 */

import { keccak256 } from "ethers";
import {
  NOTA_CONTAINER_VERSION_MAJOR,
  NOTA_CONTAINER_VERSION_MINOR,
  NOTA_EOF_MARK,
  NOTA_MAGIC,
  NOTA_TRAILER_BYTES,
  NOTA_TRAILER_TAG,
} from "../constants.js";
import { asciiBytes, concatBytes, hexToBytes, u32be } from "./bytes.js";
import { crc32 } from "./crc32.js";
import type { ObjectInput, TrailerFields, XrefEntry } from "./types.js";

/** Encodes the 16-byte header. */
export function encodeHeader(
  versionMinor: number = NOTA_CONTAINER_VERSION_MINOR,
  versionMajor: number = NOTA_CONTAINER_VERSION_MAJOR,
  flags = 0
): Uint8Array {
  for (const v of [versionMajor, versionMinor, flags]) {
    if (!Number.isInteger(v) || v < 0 || v > 0xff) {
      throw new RangeError(`header field out of range: ${v}`);
    }
  }
  const head = concatBytes([Uint8Array.from(NOTA_MAGIC), Uint8Array.of(versionMajor, versionMinor, flags)]);
  return concatBytes([head, u32be(crc32(head))]);
}

/** Encodes one object: `type`, `number`, `length`, `payload`, `crc`. */
export function encodeObject(type: string, number: number, payload: Uint8Array): Uint8Array {
  if (type.length !== 4) throw new RangeError(`object type must be four characters: ${type}`);
  const body = concatBytes([asciiBytes(type), u32be(number), u32be(payload.length), payload]);
  return concatBytes([body, u32be(crc32(body))]);
}

/** Encodes an `XREF` payload: `count`, then one 16-byte entry per object. */
export function encodeXrefPayload(entries: readonly XrefEntry[]): Uint8Array {
  const parts: Uint8Array[] = [u32be(entries.length)];
  for (const e of entries) {
    if (e.type.length !== 4) throw new RangeError(`object type must be four characters: ${e.type}`);
    parts.push(asciiBytes(e.type), u32be(e.number), u32be(e.offset), u32be(e.length));
  }
  return concatBytes(parts);
}

/** Encodes a 64-byte trailer. */
export function encodeTrailer(fields: TrailerFields): Uint8Array {
  if (fields.digest.length !== 32) throw new RangeError("trailer digest must be 32 bytes");
  const fixed = concatBytes([
    asciiBytes(NOTA_TRAILER_TAG),
    u32be(fields.revision),
    u32be(fields.xrefOffset),
    u32be(fields.prevTrailer),
    u32be(fields.size),
    fields.digest,
  ]);
  return concatBytes([fixed, u32be(crc32(fixed)), asciiBytes(NOTA_EOF_MARK)]);
}

export interface AppendRevisionParams {
  /** Revision number to write in the trailer. */
  revision: number;
  /** Offset of the previous revision's trailer. 0 for revision 0. */
  prevTrailer: number;
  /** Objects of the revision, in file order, excluding the `XREF` object. */
  objects: readonly ObjectInput[];
  /** Object number of the `XREF` object. */
  xrefNumber: number;
}

export interface AppendRevisionResult {
  /** The file with the revision appended. */
  file: Uint8Array;
  /** Offset of the new revision's `XREF` object. */
  xrefOffset: number;
  /** Offset of the new revision's trailer. */
  trailerOffset: number;
}

/**
 * Appends one revision (objects, `XREF`, trailer) to `file` and returns the
 * new bytes. `file` is a header, or a header followed by complete revisions;
 * its bytes are copied unchanged.
 *
 * Unchecked: the caller is responsible for object types, numbering and
 * payload validity.
 */
export function appendRevision(file: Uint8Array, params: AppendRevisionParams): AppendRevisionResult {
  const parts: Uint8Array[] = [file];
  const entries: XrefEntry[] = [];
  let offset = file.length;
  for (const o of params.objects) {
    const bytes = encodeObject(o.type, o.number, o.payload);
    entries.push({ type: o.type, number: o.number, offset, length: o.payload.length });
    parts.push(bytes);
    offset += bytes.length;
  }
  const xrefOffset = offset;
  const xref = encodeObject("XREF", params.xrefNumber, encodeXrefPayload(entries));
  parts.push(xref);
  offset += xref.length;

  const body = concatBytes(parts);
  const trailer = encodeTrailer({
    revision: params.revision,
    xrefOffset,
    prevTrailer: params.prevTrailer,
    size: offset + NOTA_TRAILER_BYTES,
    digest: hexToBytes(keccak256(body)),
  });
  return { file: concatBytes([body, trailer]), xrefOffset, trailerOffset: offset };
}
