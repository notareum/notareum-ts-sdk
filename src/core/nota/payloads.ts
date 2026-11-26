/**
 * Builders and validators for the `SIGN`, `RCPT` and `STAT` payloads
 * (protocol/v1.1/01-nota-format.md).
 *
 * Every builder returns a validated payload. Every validator is exact: a
 * member that is missing, unknown, or of the wrong JSON type is refused.
 */

import { keccak256, solidityPacked } from "ethers";
import { NotaConformanceError } from "../errors.js";
import { checkEcdsaSignature } from "../crypto/eip712.js";
import { encodeUtf8 } from "../utf8.js";
import { isBytes32Hex, isEip55Address, isPlainObject } from "./conformance.js";
import type {
  NotaContent,
  NotaControlProof,
  NotaReceipt,
  NotaSignature,
  NotaSignatureScheme,
  NotaStatusSnapshot,
  RegistryDeployment,
} from "./content.js";
import {
  NOTA_STATUS_STRINGS,
  VERIFICATION_LEVEL_STRINGS,
  resolveResourceTypeId,
} from "./types.js";
import type { NotaStatusString, VerificationLevelString } from "./types.js";

const HEX_BYTES_RE = /^0x([0-9a-f]{2})*$/;
const SIGNATURE_SCHEMES: readonly string[] = ["eip712-secp256k1", "erc1271"];
const CONTROL_PROOFS: readonly string[] = ["claimed", "self"];

function reject(rule: string, field: string, message: string): never {
  throw new NotaConformanceError(rule, field, message);
}

/** Requires a plain object holding exactly `members`. */
function exactObject(
  value: unknown,
  members: readonly string[],
  rule: string,
  field: string
): Record<string, unknown> {
  if (!isPlainObject(value)) reject(rule, field, "must be a JSON object");
  for (const member of members) {
    if (!Object.prototype.hasOwnProperty.call(value, member)) {
      reject(rule, `${field}.${member}`, "is required");
    }
  }
  for (const member of Object.keys(value)) {
    if (!members.includes(member)) reject(rule, `${field}.${member}`, "is not a defined member");
  }
  return value;
}

function uint(value: unknown, rule: string, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) {
    reject(
      rule,
      field,
      max === Number.MAX_SAFE_INTEGER
        ? "must be a non-negative integer no greater than 2^53 - 1"
        : `must be an integer from 0 to ${max}`
    );
  }
  return value;
}

/** Converts a number or bigint (as decoded from the chain) to a JSON-safe integer. */
function toSafeInteger(value: number | bigint, field: string): number {
  const n = typeof value === "bigint" ? value : BigInt(Number.isSafeInteger(value) ? value : -1);
  if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) {
    reject(
      "SCHEMA",
      field,
      "must be a non-negative integer no greater than 2^53 - 1 to be carried in canonical JSON"
    );
  }
  return Number(n);
}

// ---------------------------------------------------------------------------
// resourceId and control proof
// ---------------------------------------------------------------------------

/**
 * `resourceId` of the resource a content layer describes:
 * `keccak256(abi.encodePacked(uint8(resourceType), uint256(chainId), bytes(identifier)))`.
 *
 * @throws NotaConformanceError if the content's type is not a registered resource type.
 */
export function computeNotaResourceId(
  content: Pick<NotaContent, "type" | "chain" | "resource">
): string {
  const typeId = resolveResourceTypeId(content.type);
  if (typeId === undefined) {
    reject("G1", "type", `"${content.type}" is not a registered resource type`);
  }
  return keccak256(
    solidityPacked(
      ["uint8", "uint256", "bytes"],
      [typeId, content.chain.chainId, encodeUtf8(content.resource.identifier)]
    )
  );
}

/**
 * The control proof the ruleset 1 gate records for a mint: `"self"` when the
 * type is `address`, the chain has an EIP-155 ID, the identifier equals
 * `issuer.account`, and either the issuer signed as an externally owned
 * account or the resource's chain is the registry chain. `"claimed"` in every
 * other case.
 */
export function deriveControlProof(
  content: NotaContent,
  scheme: NotaSignatureScheme,
  registry: RegistryDeployment
): NotaControlProof {
  const self =
    content.type === "address" &&
    content.chain.chainId > 0 &&
    content.resource.identifier === content.issuer.account &&
    (scheme === "eip712-secp256k1" || content.chain.chainId === registry.chainId);
  return self ? "self" : "claimed";
}

// ---------------------------------------------------------------------------
// SIGN
// ---------------------------------------------------------------------------

/**
 * Validates a `SIGN` payload's form. That the signature is the issuer's is
 * checked against the content by the file reader.
 */
export function validateSignature(value: unknown): NotaSignature {
  const o = exactObject(value, ["scheme", "signature", "signer"], "SIGNATURE", "SIGN");
  if (typeof o.scheme !== "string" || !SIGNATURE_SCHEMES.includes(o.scheme)) {
    reject("SIGNATURE", "SIGN.scheme", 'must be "eip712-secp256k1" or "erc1271"');
  }
  if (o.scheme === "eip712-secp256k1") {
    const problem = checkEcdsaSignature(o.signature);
    if (problem !== null) reject("G9", "SIGN.signature", problem);
  } else if (typeof o.signature !== "string" || !HEX_BYTES_RE.test(o.signature)) {
    reject("SIGNATURE", "SIGN.signature", "must be 0x plus an even number of lowercase hex digits");
  }
  if (!isEip55Address(o.signer)) {
    reject("SIGNATURE", "SIGN.signer", "must be an EIP-55 checksummed address");
  }
  return { scheme: o.scheme as NotaSignatureScheme, signature: o.signature as string, signer: o.signer };
}

export interface SignatureInput {
  /** The signature bytes as hex (any case) or raw bytes. */
  signature: string | Uint8Array;
  /** The issuer account. */
  signer: string;
  /** The scheme. If omitted, it is derived from `signerHasCode`. */
  scheme?: NotaSignatureScheme;
  /**
   * Whether the issuer account has code on the registry chain. A contract
   * account signs with `erc1271`, anything else with `eip712-secp256k1`.
   */
  signerHasCode?: boolean;
}

/** Builds a `SIGN` payload. One of `scheme` and `signerHasCode` is required. */
export function buildSignature(input: SignatureInput): NotaSignature {
  let scheme = input.scheme;
  if (scheme === undefined) {
    if (typeof input.signerHasCode !== "boolean") {
      reject("SIGNATURE", "SIGN.scheme", "give either scheme or signerHasCode");
    }
    scheme = input.signerHasCode ? "erc1271" : "eip712-secp256k1";
  }
  return validateSignature({
    scheme,
    signature: toLowerHex(input.signature, "SIGN.signature"),
    signer: input.signer,
  });
}

function toLowerHex(value: string | Uint8Array, field: string): string {
  if (typeof value === "string") {
    if (!/^0x([0-9a-fA-F]{2})*$/.test(value)) {
      reject("SCHEMA", field, "must be 0x plus an even number of hex digits");
    }
    return value.toLowerCase();
  }
  let out = "0x";
  for (let i = 0; i < value.length; i++) out += value[i].toString(16).padStart(2, "0");
  return out;
}

// ---------------------------------------------------------------------------
// RCPT
// ---------------------------------------------------------------------------

/** Validates a registry deployment: a positive chain ID and an EIP-55 address. */
export function validateRegistry(value: unknown, field = "registry"): RegistryDeployment {
  const o = exactObject(value, ["chainId", "address"], "REGISTRY", field);
  const chainId = uint(o.chainId, "REGISTRY", `${field}.chainId`);
  if (chainId === 0) reject("REGISTRY", `${field}.chainId`, "must be greater than 0");
  if (!isEip55Address(o.address)) {
    reject("REGISTRY", `${field}.address`, "must be an EIP-55 checksummed address");
  }
  return { chainId, address: o.address };
}

/**
 * Validates a `RCPT` payload's form. That `notaId` and `resourceId` match the
 * content is checked by the file reader.
 */
export function validateReceipt(value: unknown): NotaReceipt {
  const o = exactObject(
    value,
    [
      "registry",
      "notaId",
      "resourceId",
      "ruleset",
      "controlProof",
      "transactionHash",
      "blockNumber",
      "logIndex",
      "mintedAt",
    ],
    "RECEIPT",
    "RCPT"
  );
  const registry = validateRegistry(o.registry, "RCPT.registry");
  for (const member of ["notaId", "resourceId", "transactionHash"] as const) {
    if (!isBytes32Hex(o[member])) {
      reject("RECEIPT", `RCPT.${member}`, "must be 0x plus 64 lowercase hex digits");
    }
  }
  if (typeof o.controlProof !== "string" || !CONTROL_PROOFS.includes(o.controlProof)) {
    reject("RECEIPT", "RCPT.controlProof", 'must be "self" or "claimed"');
  }
  return {
    registry,
    notaId: o.notaId as string,
    resourceId: o.resourceId as string,
    ruleset: uint(o.ruleset, "RECEIPT", "RCPT.ruleset", 0xffff),
    controlProof: o.controlProof as NotaControlProof,
    transactionHash: o.transactionHash as string,
    blockNumber: uint(o.blockNumber, "RECEIPT", "RCPT.blockNumber"),
    logIndex: uint(o.logIndex, "RECEIPT", "RCPT.logIndex"),
    mintedAt: uint(o.mintedAt, "RECEIPT", "RCPT.mintedAt"),
  };
}

export interface ReceiptInput {
  /** The registry deployment that emitted `NotaMinted`. */
  registry: RegistryDeployment;
  /** `notaId` topic of the event. */
  notaId: string;
  /** `resourceId` topic of the event. */
  resourceId: string;
  /** `ruleset` of the event. */
  ruleset: number | bigint;
  /** `controlProof` of the event: the enum value (0 `CLAIMED`, 1 `SELF`) or its name. */
  controlProof: NotaControlProof | number | bigint;
  /** Hash of the mint transaction. */
  transactionHash: string;
  /** Number of the block that included the mint. */
  blockNumber: number | bigint;
  /** Index of the `NotaMinted` log in its block. */
  logIndex: number | bigint;
  /** Timestamp of the block that included the mint. */
  mintedAt: number | bigint;
}

/** Converts the on-chain `ControlProof` enum (0 `CLAIMED`, 1 `SELF`) to its receipt name. */
export function controlProofName(value: NotaControlProof | number | bigint): NotaControlProof {
  if (value === "claimed" || value === 0 || value === 0n) return "claimed";
  if (value === "self" || value === 1 || value === 1n) return "self";
  return reject("RECEIPT", "RCPT.controlProof", 'must be "self", "claimed", or the enum value 0 or 1');
}

/**
 * Builds an `RCPT` payload from the position and fields of a `NotaMinted`
 * event. Hex values are lowercased; numbers decoded as bigint are converted.
 */
export function buildReceipt(input: ReceiptInput): NotaReceipt {
  return validateReceipt({
    registry: { chainId: input.registry.chainId, address: input.registry.address },
    notaId: toLowerHex(input.notaId, "RCPT.notaId"),
    resourceId: toLowerHex(input.resourceId, "RCPT.resourceId"),
    ruleset: toSafeInteger(input.ruleset, "RCPT.ruleset"),
    controlProof: controlProofName(input.controlProof),
    transactionHash: toLowerHex(input.transactionHash, "RCPT.transactionHash"),
    blockNumber: toSafeInteger(input.blockNumber, "RCPT.blockNumber"),
    logIndex: toSafeInteger(input.logIndex, "RCPT.logIndex"),
    mintedAt: toSafeInteger(input.mintedAt, "RCPT.mintedAt"),
  });
}

// ---------------------------------------------------------------------------
// STAT
// ---------------------------------------------------------------------------

/**
 * Validates a `STAT` payload.
 *
 * `level`, `requestId`, `approvals`, `rejections` and `transactionHash`
 * describe the most recent resolved social verification request and are all
 * empty when there is none; a `verified` status requires one.
 */
export function validateStatusSnapshot(value: unknown): NotaStatusSnapshot {
  const o = exactObject(
    value,
    [
      "asOfBlock",
      "asOfTime",
      "status",
      "level",
      "requestId",
      "approvals",
      "rejections",
      "transactionHash",
    ],
    "ANNEX",
    "STAT"
  );
  if (typeof o.status !== "string" || !(NOTA_STATUS_STRINGS as readonly string[]).includes(o.status)) {
    reject("ANNEX", "STAT.status", `must be one of: ${NOTA_STATUS_STRINGS.join(", ")}`);
  }
  if (
    typeof o.level !== "string" ||
    (o.level !== "" && !(VERIFICATION_LEVEL_STRINGS as readonly string[]).includes(o.level))
  ) {
    reject("ANNEX", "STAT.level", `must be "" or one of: ${VERIFICATION_LEVEL_STRINGS.join(", ")}`);
  }
  if (typeof o.transactionHash !== "string" || (o.transactionHash !== "" && !isBytes32Hex(o.transactionHash))) {
    reject("ANNEX", "STAT.transactionHash", 'must be "" or 0x plus 64 lowercase hex digits');
  }
  const snapshot: NotaStatusSnapshot = {
    asOfBlock: uint(o.asOfBlock, "ANNEX", "STAT.asOfBlock"),
    asOfTime: uint(o.asOfTime, "ANNEX", "STAT.asOfTime"),
    status: o.status as NotaStatusString,
    level: o.level as VerificationLevelString | "",
    requestId: uint(o.requestId, "ANNEX", "STAT.requestId"),
    approvals: uint(o.approvals, "ANNEX", "STAT.approvals"),
    rejections: uint(o.rejections, "ANNEX", "STAT.rejections"),
    transactionHash: o.transactionHash,
  };
  if ((snapshot.level === "") !== (snapshot.transactionHash === "")) {
    reject(
      "ANNEX",
      "STAT.level",
      "level and transactionHash describe one resolved request: both are set or both are empty"
    );
  }
  if (snapshot.level === "") {
    if (snapshot.requestId !== 0 || snapshot.approvals !== 0 || snapshot.rejections !== 0) {
      reject(
        "ANNEX",
        "STAT.requestId",
        "requestId, approvals and rejections must be 0 when there is no resolved request"
      );
    }
    if (snapshot.status === "verified") {
      reject("ANNEX", "STAT.level", 'a "verified" status requires the request that verified it');
    }
  }
  return snapshot;
}

export interface StatusSnapshotInput {
  asOfBlock: number | bigint;
  asOfTime: number | bigint;
  /** The status name, or the `NotaStatus` enum value. */
  status: NotaStatusString | number | bigint;
  /**
   * The most recent resolved social verification request. Omit when there is none:
   * `level`, `requestId`, `approvals`, `rejections` and `transactionHash` are
   * then written as their empty values.
   */
  request?: {
    /** The level name, or the `VerificationLevel` enum value. */
    level: VerificationLevelString | number | bigint;
    requestId: number | bigint;
    approvals: number | bigint;
    rejections: number | bigint;
    /** Transaction that resolved the request. */
    transactionHash: string;
  };
}

/** Builds a `STAT` payload from what the registry and the Verification Engine report. */
export function buildStatusSnapshot(input: StatusSnapshotInput): NotaStatusSnapshot {
  const status = enumName(input.status, NOTA_STATUS_STRINGS, "STAT.status");
  const request = input.request;
  return validateStatusSnapshot({
    asOfBlock: toSafeInteger(input.asOfBlock, "STAT.asOfBlock"),
    asOfTime: toSafeInteger(input.asOfTime, "STAT.asOfTime"),
    status,
    level: request ? enumName(request.level, VERIFICATION_LEVEL_STRINGS, "STAT.level") : "",
    requestId: request ? toSafeInteger(request.requestId, "STAT.requestId") : 0,
    approvals: request ? toSafeInteger(request.approvals, "STAT.approvals") : 0,
    rejections: request ? toSafeInteger(request.rejections, "STAT.rejections") : 0,
    transactionHash: request ? toLowerHex(request.transactionHash, "STAT.transactionHash") : "",
  });
}

function enumName<T extends string>(
  value: T | number | bigint,
  names: readonly T[],
  field: string
): T {
  if (typeof value === "string") {
    if (!names.includes(value)) reject("ANNEX", field, `must be one of: ${names.join(", ")}`);
    return value;
  }
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index >= names.length) {
    reject("ANNEX", field, `enum value ${String(value)} is out of range`);
  }
  return names[index];
}
