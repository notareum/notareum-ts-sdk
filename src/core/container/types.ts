/**
 * Structural types for the v1.1 `.nota` container.
 */

import type { JsonObject } from "../json/canonical.js";

/** Object types defined by v1.1. */
export const NOTA_OBJECT_TYPES = Object.freeze({
  /** Content layer. Revision 0, exactly one. */
  CONT: "CONT",
  /** Metadata. Revision 0, zero or one. */
  META: "META",
  /** Issuer signature. Revision 0, exactly one. */
  SIGN: "SIGN",
  /** Registry receipt. Revision 0, exactly one. */
  RCPT: "RCPT",
  /** Status snapshot. Revision 1 and later. */
  STAT: "STAT",
  /** Cross-reference table. Exactly one per revision. */
  XREF: "XREF",
} as const);

/** Object types reserved for future versions. They MUST NOT appear in a v1.1 file. */
export const NOTA_RESERVED_OBJECT_TYPES: readonly string[] = Object.freeze(["VIEW", "ATCH"]);

/** Fixed object numbers of revision 0. Number 2 is left unused when there is no metadata. */
export const NOTA_MINTED_BODY_NUMBERS = Object.freeze({
  CONT: 1,
  META: 2,
  SIGN: 3,
  RCPT: 4,
  XREF: 5,
} as const);

/** Object types whose payload is canonical JSON. */
export const NOTA_JSON_OBJECT_TYPES: readonly string[] = Object.freeze([
  "CONT",
  "META",
  "SIGN",
  "RCPT",
  "STAT",
]);

/** One object of a container, as located by its revision's `XREF` table. */
export interface ContainerObject {
  /** Four ASCII letters. */
  type: string;
  /** Object number, unique within the file. */
  number: number;
  /** Revision the object belongs to. */
  revision: number;
  /** Absolute offset of the object's `type` field. */
  offset: number;
  /** Payload length in bytes. */
  length: number;
  /** The payload. A view into the file that was read, not a copy. */
  payload: Uint8Array;
  /** False for ancillary types (lowercase first letter). */
  critical: boolean;
  /** False for an ancillary type this reader does not recognize and therefore ignores. */
  recognized: boolean;
  /** The parsed payload, for object types whose payload is canonical JSON. */
  json?: JsonObject;
}

/** One revision: a run of objects, an `XREF` object, and a trailer. */
export interface ContainerRevision {
  /** Revision number. 0 is the minted body. */
  revision: number;
  /** Offset of the revision's first byte. */
  offset: number;
  /** The revision's objects in file order, excluding the `XREF` object. */
  objects: ContainerObject[];
  /** Offset of the `XREF` object. */
  xrefOffset: number;
  /** Object number of the `XREF` object. */
  xrefNumber: number;
  /** Offset of the trailer. */
  trailerOffset: number;
  /** Offset of the previous revision's trailer. 0 in revision 0. */
  prevTrailer: number;
  /** File length through the end of this trailer. */
  size: number;
  /** keccak256 of every file byte before this trailer, as lowercase hex. */
  digest: string;
}

/** A container that passed every structural rejection rule. */
export interface Container {
  versionMajor: number;
  versionMinor: number;
  flags: number;
  /** Revisions in file order. Index equals revision number. */
  revisions: ContainerRevision[];
  /** Total length in bytes. */
  size: number;
}

/** An object to be written. */
export interface ObjectInput {
  type: string;
  number: number;
  payload: Uint8Array;
}

/** One `XREF` entry. */
export interface XrefEntry {
  type: string;
  number: number;
  offset: number;
  length: number;
}

/** The fields of a trailer that precede `trailerCrc`. */
export interface TrailerFields {
  revision: number;
  xrefOffset: number;
  prevTrailer: number;
  size: number;
  /** 32 bytes. */
  digest: Uint8Array;
}
