/**
 * Custom error classes for the @notareum/core library.
 */

export class NotaParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotaParseError";
  }
}

export class NotaValidationError extends Error {
  public readonly field: string;
  constructor(field: string, message: string) {
    super(`[${field}] ${message}`);
    this.name = "NotaValidationError";
    this.field = field;
  }
}

export class NotaSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotaSignatureError";
  }
}

export class NotaHashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotaHashError";
  }
}

export class QuorumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuorumError";
  }
}

export class StakingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StakingError";
  }
}

export class ResourceIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceIdError";
  }
}

// ---------------------------------------------------------------------------
// v1.1 container and content errors
// ---------------------------------------------------------------------------

/**
 * Why a strict container read failed. Each code maps to a rejection rule in
 * "Reading a File" (protocol/v1.1/01-nota-format.md).
 */
export type NotaContainerErrorCode =
  /** The magic number does not match. */
  | "BAD_MAGIC"
  /** The file starts with `{`: a v1.0 JSON document, not a v1.1 container. */
  | "LEGACY_DOCUMENT"
  /** `versionMajor` is not one this library implements. */
  | "UNSUPPORTED_VERSION"
  /** A reserved header flag bit is set. */
  | "BAD_FLAGS"
  /** A header, object or trailer CRC-32 does not match. */
  | "BAD_CRC"
  /** A trailer is malformed, or the chain of trailers is inconsistent. */
  | "BAD_TRAILER"
  /** A trailer `digest` does not match the bytes before it. */
  | "BAD_DIGEST"
  /** A trailer `size` does not match. */
  | "BAD_SIZE"
  /** The file ends before a complete structure. */
  | "TRUNCATED"
  /** Bytes follow the final trailer. */
  | "TRAILING_DATA"
  /** Bytes that belong to no structure (a gap or padding). */
  | "GAP"
  /** Two structures overlap. */
  | "OVERLAP"
  /** An `XREF` table is malformed or disagrees with the object it points to. */
  | "XREF_MISMATCH"
  /** An object type is not four ASCII letters. */
  | "BAD_OBJECT_TYPE"
  /** An object number is duplicated, out of order, or not the required number. */
  | "BAD_OBJECT_NUMBER"
  /** A critical object type this reader does not recognize. */
  | "UNKNOWN_CRITICAL_TYPE"
  /** An object appears in a revision it is not permitted in. */
  | "MISPLACED_OBJECT"
  /** Revision 0 objects are not in the required order. */
  | "BAD_OBJECT_ORDER"
  /** A required object is missing. */
  | "MISSING_OBJECT"
  /** An object that may appear once appears more than once. */
  | "DUPLICATE_OBJECT"
  /** An annex revision carries no objects. */
  | "EMPTY_ANNEX"
  /** A JSON payload is not canonical JSON (RFC 8785). */
  | "NON_CANONICAL_JSON"
  /** A JSON payload is not a JSON object. */
  | "BAD_PAYLOAD"
  /** A JSON payload violates Content Safety Rules T1 through T6. */
  | "CONTENT_SAFETY"
  /** The file, a payload, or the JSON nesting depth exceeds a size limit. */
  | "SIZE_LIMIT";

/** A `.nota` container was rejected by the strict reader. There is no lenient mode. */
export class NotaContainerError extends Error {
  public readonly code: NotaContainerErrorCode;
  /** Absolute byte offset the failure relates to, when there is one. */
  public readonly offset: number | undefined;
  /** For `CONTENT_SAFETY`: the Content Safety Rule that was violated (`T1` to `T6`). */
  public readonly rule: string | undefined;
  constructor(
    code: NotaContainerErrorCode,
    message: string,
    detail: { offset?: number; rule?: string } = {}
  ) {
    super(`invalid .nota container [${code}]: ${message}`);
    this.name = "NotaContainerError";
    this.code = code;
    this.offset = detail.offset;
    this.rule = detail.rule;
  }
}

/**
 * Content that the Conformance Gate would refuse, or a payload that does not
 * match its schema. `rule` is the gate rule (`G1` to `G9`), the Content Safety
 * Rule (`T1` to `T6`), or one of `SCHEMA`, `NFC`, `SIGNATURE`, `RECEIPT`,
 * `REGISTRY`, `ANNEX`.
 */
export class NotaConformanceError extends NotaValidationError {
  public readonly rule: string;
  constructor(rule: string, field: string, message: string) {
    super(field, `${rule}: ${message}`);
    this.name = "NotaConformanceError";
    this.rule = rule;
  }
}

/** A value cannot be serialized as, or bytes are not, canonical JSON (RFC 8785). */
export class CanonicalJsonError extends Error {
  public readonly reason:
    | "utf8"
    | "syntax"
    | "depth"
    | "non-canonical"
    | "unsupported-value";
  constructor(reason: CanonicalJsonError["reason"], message: string) {
    super(message);
    this.name = "CanonicalJsonError";
    this.reason = reason;
  }
}
