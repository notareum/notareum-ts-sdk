/**
 * Reading and writing whole `.nota` files (protocol/v1.1/01-nota-format.md).
 *
 * `readNota` is the reader: it applies the container's rejection rules and
 * then the offline trust rules (recompute `notaId`, `metadataHash` and
 * `resourceId`; check the signature; optionally check the registry against a
 * pinned list). Every writer here verifies its output with `readNota`, so
 * this library never emits a file its own reader would refuse.
 */

import { keccak256 } from "ethers";
import {
  MAX_CLOCK_SKEW_SECONDS,
  MINT_WINDOW_SECONDS,
  NOTA_MAX_FILE_BYTES,
  NOTA_RULESET,
  NOTA_TRAILER_BYTES,
} from "../constants.js";
import { hexToBytes } from "../container/bytes.js";
import { readContainer } from "../container/reader.js";
import type { ObjectInput } from "../container/types.js";
import { appendRevision, encodeHeader } from "../container/writer.js";
import { computeNotaId, recoverNotaSigner } from "../crypto/eip712.js";
import { NotaConformanceError, NotaContainerError, NotaSignatureError } from "../errors.js";
import { canonicalBytes } from "../json/canonical.js";
import type { JsonObject } from "../json/canonical.js";
import { isPlainObject, validateContent } from "./conformance.js";
import type {
  NotaAnnexInput,
  NotaAnnexObject,
  NotaContent,
  NotaControlProof,
  NotaFile,
  NotaReceipt,
  NotaSignature,
  NotaStatusSnapshot,
  RegistryDeployment,
} from "./content.js";
import { computeMetadataHash, encodeMetadata, validateMetadataBytes } from "./metadata.js";
import {
  buildReceipt,
  buildSignature,
  computeNotaResourceId,
  deriveControlProof,
  validateReceipt,
  validateSignature,
  validateStatusSnapshot,
} from "./payloads.js";

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface ReadNotaOptions {
  /**
   * The reader's own pinned list of canonical registry deployments (trust
   * rule 4). When given, a file whose receipt names any other registry is
   * refused. When omitted, the check is not made and `registryPinned` is
   * false: the caller MUST NOT query, or extend trust to, a registry merely
   * because a file names it.
   */
  trustedRegistries?: readonly RegistryDeployment[];
}

/**
 * Reads a `.nota` file. There is no lenient mode.
 *
 * Applies, in order: every container rejection rule (`readContainer`); the
 * content schema and the locally decidable Conformance Gate rules; the
 * metadata binding; the form of the signature and receipt; recomputation of
 * `notaId` and `resourceId` against the receipt; signer recovery for
 * `eip712-secp256k1`; for ruleset 1, the control proof and mint time window
 * the gate guarantees; the pinned-registry check if a list is given; and the
 * schema of every `STAT` annex object.
 *
 * The result is the **Unconfirmed** state. It shows that the file is well
 * formed, internally consistent, and signed by `issuer.account`. It does not
 * show that the file was minted; only the registry does.
 *
 * @throws NotaContainerError for a structural violation.
 * @throws NotaConformanceError for a content, signature, receipt or annex violation.
 */
export function readNota(file: Uint8Array, options: ReadNotaOptions = {}): NotaFile {
  const container = readContainer(file);
  const minted = container.revisions[0];
  const objectOf = (type: string) => minted.objects.find((o) => o.type === type);
  const cont = objectOf("CONT");
  const meta = objectOf("META");
  const sign = objectOf("SIGN");
  const rcpt = objectOf("RCPT");
  if (cont === undefined || sign === undefined || rcpt === undefined) {
    // readContainer guarantees these; this guards the invariant, not the input.
    throw new NotaContainerError("MISSING_OBJECT", "revision 0 is incomplete");
  }

  // Content: schema and gate rules G1 through G6.
  const contentJson: unknown = cont.json;
  validateContent(contentJson);
  const content: NotaContent = contentJson;

  // Metadata binding (G7).
  let metadata: JsonObject | null = null;
  let metadataBytes: Uint8Array | null = null;
  if (meta !== undefined) {
    metadata = validateMetadataBytes(meta.payload);
    metadataBytes = meta.payload;
  }
  const metadataHash = computeMetadataHash(metadataBytes);
  if (content.metadataHash !== metadataHash) {
    throw new NotaConformanceError(
      "G7",
      "metadataHash",
      metadataBytes === null
        ? "must be the zero hash when the file has no META object"
        : `does not match keccak256 of the META payload (${metadataHash})`
    );
  }

  const signature = validateSignature(sign.json);
  const receipt = validateReceipt(rcpt.json);

  // Recompute notaId and resourceId and compare with the receipt.
  const notaId = computeNotaId(content, receipt.registry);
  if (receipt.notaId !== notaId) {
    throw new NotaConformanceError(
      "RECEIPT",
      "RCPT.notaId",
      `does not match the notaId recomputed from CONT under the receipt's registry (${notaId})`
    );
  }
  const resourceId = computeNotaResourceId(content);
  if (receipt.resourceId !== resourceId) {
    throw new NotaConformanceError(
      "RECEIPT",
      "RCPT.resourceId",
      `does not match the resourceId recomputed from CONT (${resourceId})`
    );
  }

  // Signature (G9).
  if (signature.signer !== content.issuer.account) {
    throw new NotaConformanceError("G9", "SIGN.signer", "must equal issuer.account");
  }
  let signatureVerified = false;
  if (signature.scheme === "eip712-secp256k1") {
    let recovered: string;
    try {
      recovered = recoverNotaSigner(notaId, signature.signature);
    } catch (err) {
      if (err instanceof NotaSignatureError) {
        throw new NotaConformanceError("G9", "SIGN.signature", err.message);
      }
      throw err;
    }
    if (recovered !== content.issuer.account) {
      throw new NotaConformanceError(
        "G9",
        "SIGN.signature",
        `recovers to ${recovered}, not to issuer.account ${content.issuer.account}`
      );
    }
    signatureVerified = true;
  }

  // What the ruleset 1 gate guarantees about any receipt it produced.
  if (receipt.ruleset === NOTA_RULESET) {
    const controlProof = deriveControlProof(content, signature.scheme, receipt.registry);
    if (receipt.controlProof !== controlProof) {
      throw new NotaConformanceError(
        "RECEIPT",
        "RCPT.controlProof",
        `is "${receipt.controlProof}", but the gate records "${controlProof}" for this content and signature`
      );
    }
    if (
      content.issuedAt < receipt.mintedAt - MINT_WINDOW_SECONDS ||
      content.issuedAt > receipt.mintedAt + MAX_CLOCK_SKEW_SECONDS
    ) {
      throw new NotaConformanceError(
        "G8",
        "issuedAt",
        "is outside the mint window around the receipt's mintedAt"
      );
    }
    if (content.expiresAt !== 0 && content.expiresAt <= receipt.mintedAt) {
      throw new NotaConformanceError(
        "G8",
        "expiresAt",
        "must be 0 or later than the receipt's mintedAt"
      );
    }
  }

  // Pinned registries (trust rule 4).
  let registryPinned = false;
  if (options.trustedRegistries !== undefined) {
    registryPinned = options.trustedRegistries.some(
      (r) =>
        r.chainId === receipt.registry.chainId &&
        typeof r.address === "string" &&
        r.address.toLowerCase() === receipt.registry.address.toLowerCase()
    );
    if (!registryPinned) {
      throw new NotaConformanceError(
        "REGISTRY",
        "RCPT.registry",
        "is not on the reader's pinned list of canonical registries"
      );
    }
  }

  // Annex objects. readContainer admits only STAT and unrecognized ancillary
  // objects here; the latter are ignored.
  const annexObjects: NotaAnnexObject[] = [];
  let statusSnapshot: NotaStatusSnapshot | null = null;
  for (const revision of container.revisions.slice(1)) {
    for (const o of revision.objects) {
      if (o.type !== "STAT") continue;
      const snapshot = validateStatusSnapshot(o.json);
      checkSnapshotAge(snapshot, receipt);
      annexObjects.push({ type: "STAT", number: o.number, revision: o.revision, snapshot });
      if (statusSnapshot === null || snapshot.asOfBlock >= statusSnapshot.asOfBlock) {
        statusSnapshot = snapshot;
      }
    }
  }

  return {
    state: "unconfirmed",
    versionMinor: container.versionMinor,
    content,
    metadata,
    metadataBytes,
    signature,
    receipt,
    notaId,
    resourceId,
    signatureVerified,
    registryPinned,
    annexObjects,
    statusSnapshot,
    fileHash: keccak256(file),
    container,
  };
}

/** A snapshot describes registry state, so it cannot predate the mint. */
function checkSnapshotAge(snapshot: NotaStatusSnapshot, receipt: NotaReceipt): void {
  if (snapshot.asOfBlock < receipt.blockNumber) {
    throw new NotaConformanceError(
      "ANNEX",
      "STAT.asOfBlock",
      "is earlier than the block that minted the file"
    );
  }
  if (snapshot.asOfTime < receipt.mintedAt) {
    throw new NotaConformanceError("ANNEX", "STAT.asOfTime", "is earlier than the receipt's mintedAt");
  }
}

// ---------------------------------------------------------------------------
// Writing revision 0
// ---------------------------------------------------------------------------

export interface WriteNotaInput {
  content: NotaContent;
  /**
   * The metadata that was minted. Bytes are written verbatim as the `META`
   * payload and must already be canonical; an object is serialized
   * canonically. Omit, or pass `null` or zero bytes, when there is none.
   */
  metadata?: Uint8Array | Record<string, unknown> | null;
  signature: NotaSignature;
  /** The receipt of the mint. A file with no receipt is a draft, not a `.nota` file. */
  receipt: NotaReceipt;
}

/**
 * Writes revision 0, the minted body: `CONT` #1, `META` #2 (if there is
 * metadata), `SIGN` #3, `RCPT` #4, `XREF` #5 and the trailer.
 *
 * Every byte is determined by the mint, so two conforming implementations
 * produce identical output for the same mint. Call this only after the mint
 * transaction is final on the registry chain.
 *
 * @throws NotaConformanceError or NotaContainerError if the result would not
 *   be a valid `.nota` file; nothing invalid is returned.
 */
export function writeNota(input: WriteNotaInput): Uint8Array {
  validateContent(input.content);
  const objects: ObjectInput[] = [
    { type: "CONT", number: 1, payload: canonicalBytes(input.content) },
  ];
  const metadata = input.metadata;
  if (metadata !== undefined && metadata !== null) {
    if (metadata instanceof Uint8Array) {
      if (metadata.length > 0) objects.push({ type: "META", number: 2, payload: metadata });
    } else {
      objects.push({ type: "META", number: 2, payload: encodeMetadata(metadata) });
    }
  }
  objects.push(
    { type: "SIGN", number: 3, payload: canonicalBytes(validateSignature(input.signature)) },
    { type: "RCPT", number: 4, payload: canonicalBytes(validateReceipt(input.receipt)) }
  );
  const { file } = appendRevision(encodeHeader(), {
    revision: 0,
    prevTrailer: 0,
    objects,
    xrefNumber: 5,
  });
  readNota(file);
  return file;
}

// ---------------------------------------------------------------------------
// Reconstruction from a NotaMinted event
// ---------------------------------------------------------------------------

/**
 * Human-readable ABI of the `NotaMinted` event, for use with an ethers
 * `Interface`. `ControlProof` is a `uint8` (0 `CLAIMED`, 1 `SELF`); `type_`
 * and `alias_` carry a trailing underscore because the names are reserved in
 * Solidity.
 */
export const NOTA_MINTED_EVENT_ABI =
  "event NotaMinted(bytes32 indexed notaId, bytes32 indexed resourceId, address indexed issuer, " +
  "uint16 ruleset, uint8 controlProof, " +
  "tuple(string version, string type_, " +
  "tuple(string name, uint256 chainId, string network) chain, " +
  "tuple(string identifier, string name, string alias_, string description) resource, " +
  "tuple(address account, string name, string entityType) issuer, " +
  "bytes32 metadataHash, bytes32 supersedes, uint64 issuedAt, uint64 expiresAt) nota, " +
  "bytes metadata, bytes signature)";

/** The Solidity `Nota` struct as decoded from calldata or a log. */
export interface MintedNotaStruct {
  version: string;
  /** `type` in the content layer. Either spelling is accepted. */
  type_?: string;
  type?: string;
  chain: { name: string; chainId: number | bigint; network: string };
  resource: {
    identifier: string;
    name: string;
    /** `alias` in the content layer. Either spelling is accepted. */
    alias_?: string;
    alias?: string;
    description: string;
  };
  issuer: { account: string; name: string; entityType: string };
  metadataHash: string;
  supersedes: string;
  issuedAt: number | bigint;
  expiresAt: number | bigint;
}

/** The fields of a `NotaMinted` event. An ethers `Result` (`parseLog(log).args`) is accepted. */
export interface NotaMintedEvent {
  notaId: string;
  resourceId: string;
  issuer: string;
  ruleset: number | bigint;
  /** The `ControlProof` enum value (0 `CLAIMED`, 1 `SELF`) or its name. */
  controlProof: NotaControlProof | number | bigint;
  nota: MintedNotaStruct;
  /** The metadata bytes: hex or raw. Empty when the file has no metadata. */
  metadata: string | Uint8Array;
  /** The signature bytes: hex or raw. */
  signature: string | Uint8Array;
}

/** Where a `NotaMinted` event was found, and what the chain says about the issuer. */
export interface MintLocation {
  /** The pinned registry deployment the log was fetched from. */
  registry: RegistryDeployment;
  transactionHash: string;
  blockNumber: number | bigint;
  logIndex: number | bigint;
  /** Timestamp of the block that included the mint. */
  blockTimestamp: number | bigint;
  /**
   * Whether `issuer.account` has code on the registry chain. The signature
   * scheme is `erc1271` if it does and `eip712-secp256k1` otherwise.
   */
  issuerHasCode: boolean;
}

/** Unwraps an ethers `Result` into plain objects; passes plain objects through. */
function plain<T>(value: T): T {
  const candidate = value as unknown as { toObject?: (deep?: boolean) => unknown };
  if (
    value !== null &&
    typeof value === "object" &&
    Array.isArray(value) &&
    typeof candidate.toObject === "function"
  ) {
    return candidate.toObject(true) as T;
  }
  return value;
}

function uint64Number(value: unknown, field: string): number {
  let n: bigint;
  if (typeof value === "bigint") n = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) n = BigInt(value);
  else throw new NotaConformanceError("SCHEMA", field, "must be an integer");
  if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new NotaConformanceError(
      "SCHEMA",
      field,
      "exceeds 2^53 - 1 and cannot be carried in canonical JSON, so no .nota file exists for this mint"
    );
  }
  return Number(n);
}

function bytesOf(value: unknown, field: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string" && /^0x([0-9a-fA-F]{2})*$/.test(value)) return hexToBytes(value);
  throw new NotaConformanceError("SCHEMA", field, "must be bytes or a 0x-prefixed hex string");
}

/**
 * Converts the Solidity `Nota` struct, as decoded from a `NotaMinted` log or
 * from `mint` calldata, into the content layer. The result is validated.
 *
 * @throws NotaConformanceError if the struct is not content the gate accepts.
 */
export function contentFromMintedStruct(nota: MintedNotaStruct): NotaContent {
  const s = plain(nota) as unknown as Record<string, unknown>;
  if (!isPlainObject(s) || !isPlainObject(s.chain) || !isPlainObject(s.resource) || !isPlainObject(s.issuer)) {
    throw new NotaConformanceError("SCHEMA", "nota", "is not a decoded Nota struct");
  }
  const lower = (value: unknown): unknown => (typeof value === "string" ? value.toLowerCase() : value);
  const content = {
    version: s.version,
    type: s.type_ ?? s.type,
    chain: {
      name: s.chain.name,
      chainId: uint64Number(s.chain.chainId, "chain.chainId"),
      network: s.chain.network,
    },
    resource: {
      identifier: s.resource.identifier,
      name: s.resource.name,
      alias: s.resource.alias_ ?? s.resource.alias,
      description: s.resource.description,
    },
    issuer: {
      account: s.issuer.account,
      name: s.issuer.name,
      entityType: s.issuer.entityType,
    },
    metadataHash: lower(s.metadataHash),
    supersedes: lower(s.supersedes),
    issuedAt: uint64Number(s.issuedAt, "issuedAt"),
    expiresAt: uint64Number(s.expiresAt, "expiresAt"),
  };
  validateContent(content);
  return content;
}

/**
 * Reconstructs revision 0 of a `.nota` file from the fields of its
 * `NotaMinted` event (protocol/v1.1/10-conformance-gate.md "Reconstruction").
 *
 * `nota` is serialized to canonical JSON as `CONT`, `metadata` is taken
 * verbatim as `META`, `SIGN` is built from `signature` and
 * `nota.issuer.account`, and `RCPT` from the log's position, block timestamp,
 * `ruleset` and `controlProof`. The result is byte-identical to the file the
 * issuer's SDK wrote.
 *
 * The caller fetches the log from a registry deployment on its own pinned
 * list; this function checks that the event's `notaId`, `resourceId` and
 * `issuer` agree with the content under that deployment.
 *
 * @throws NotaConformanceError or NotaContainerError if the event does not
 *   describe a valid file.
 */
export function reconstructFromMintEvent(event: NotaMintedEvent, location: MintLocation): Uint8Array {
  const e = plain(event);
  const content = contentFromMintedStruct(e.nota);
  if (typeof e.issuer !== "string" || e.issuer.toLowerCase() !== content.issuer.account.toLowerCase()) {
    throw new NotaConformanceError(
      "RECEIPT",
      "issuer",
      "the event's issuer topic does not equal nota.issuer.account"
    );
  }
  const signature = buildSignature({
    signature: bytesOf(e.signature, "signature"),
    signer: content.issuer.account,
    signerHasCode: location.issuerHasCode,
  });
  const receipt = buildReceipt({
    registry: location.registry,
    notaId: e.notaId,
    resourceId: e.resourceId,
    ruleset: e.ruleset,
    controlProof: e.controlProof,
    transactionHash: location.transactionHash,
    blockNumber: location.blockNumber,
    logIndex: location.logIndex,
    mintedAt: location.blockTimestamp,
  });
  // writeNota verifies the result with readNota, which recomputes notaId and
  // resourceId from the content and refuses a receipt that disagrees.
  return writeNota({
    content,
    metadata: bytesOf(e.metadata, "metadata"),
    signature,
    receipt,
  });
}

// ---------------------------------------------------------------------------
// Annexes
// ---------------------------------------------------------------------------

function encodeAnnexObjects(objects: readonly NotaAnnexInput[], firstNumber: number): ObjectInput[] {
  if (objects.length === 0) {
    throw new NotaConformanceError("ANNEX", "objects", "an annex must carry at least one object");
  }
  let number = firstNumber;
  return objects.map((o) => {
    // The type is checked at run time too: callers are not always TypeScript.
    if ((o as { type: unknown }).type !== "STAT") {
      throw new NotaConformanceError("ANNEX", "type", "an annex may carry only STAT objects");
    }
    const payload = canonicalBytes(validateStatusSnapshot(o.snapshot));
    return { type: "STAT", number: number++, payload };
  });
}

/**
 * Appends an annex revision carrying `STAT` snapshots, and returns the new
 * file. Earlier bytes are not altered, so the minted body keeps its
 * digest. Object numbers continue from the highest number in the file.
 *
 * The input is read strictly first: an annex is never appended to a file the
 * reader would refuse. Annex objects are cached snapshots of registry state,
 * not proofs.
 *
 * @throws NotaContainerError with code `SIZE_LIMIT` if the result would
 *   exceed 65,536 bytes. Use {@link collapseAnnexes} to drop stale snapshots.
 */
export function appendAnnex(file: Uint8Array, objects: readonly NotaAnnexInput[]): Uint8Array {
  const { container } = readNota(file);
  const last = container.revisions[container.revisions.length - 1];
  const encoded = encodeAnnexObjects(objects, last.xrefNumber + 1);
  const { file: out } = appendRevision(file, {
    revision: container.revisions.length,
    prevTrailer: last.trailerOffset,
    objects: encoded,
    xrefNumber: last.xrefNumber + 1 + encoded.length,
  });
  if (out.length > NOTA_MAX_FILE_BYTES) {
    throw new NotaContainerError(
      "SIZE_LIMIT",
      `the file would be ${out.length} bytes; the limit is ${NOTA_MAX_FILE_BYTES}. Collapse stale annexes first.`
    );
  }
  readNota(out);
  return out;
}

/**
 * Returns revision 0 alone: the minted body, without any annex. The bytes are
 * a complete, valid `.nota` file.
 */
export function extractMintedBody(file: Uint8Array): Uint8Array {
  const { container } = readNota(file);
  return file.slice(0, container.revisions[0].trailerOffset + NOTA_TRAILER_BYTES);
}

/**
 * Rewrites a file as revision 0 plus at most one annex, dropping stale
 * snapshots.
 *
 * With `fresh`, the single annex carries those objects. Without it, the
 * annex carries the file's current `STAT` snapshot (the one with the highest
 * `asOfBlock`); a file with no snapshot is returned as its minted body.
 */
export function collapseAnnexes(file: Uint8Array, fresh?: readonly NotaAnnexInput[]): Uint8Array {
  const nota = readNota(file);
  const body = file.slice(0, nota.container.revisions[0].trailerOffset + NOTA_TRAILER_BYTES);
  let objects = fresh;
  if (objects === undefined) {
    objects =
      nota.statusSnapshot === null ? [] : [{ type: "STAT", snapshot: nota.statusSnapshot }];
  }
  return objects.length === 0 ? body : appendAnnex(body, objects);
}
