/**
 * The mint flow's building blocks (protocol/v1.1/10-conformance-gate.md),
 * with no provider or signer involved.
 *
 * `RegistryClient` and `NotaFileClient` drive these with ethers. An
 * application that signs and sends with something else (wagmi, viem, a relayer)
 * uses them directly: build the typed data, hand it to the wallet, pass
 * `mintArguments` to `mint`, and assemble the file from the receipt's logs.
 */

import { Interface, Signature, getAddress } from "ethers";
import type { TypedDataField } from "ethers";
import { NotareumNotaRegistryABI } from "./abi/index.js";
import {
  NOTA_EIP712_PRIMARY_TYPE,
  NOTA_EIP712_TYPES,
  NOTA_FILE_EXTENSION,
  NotaSignatureError,
  buildSignature,
  computeNotaId,
  controlProofName,
  notaDomain,
  reconstructFromMintEvent,
  validateSignature,
  verifyNotaSignature,
} from "./core/index.js";
import type {
  NotaContent,
  NotaDraft,
  NotaMintedEvent,
  NotaSignature,
  RegistryDeployment,
} from "./core/index.js";
import type { MintedNota } from "./types.js";

// ---------------------------------------------------------------------------
// Gate rules
// ---------------------------------------------------------------------------

/** The Conformance Gate's rules, keyed by the number carried in `ConformanceFailed(rule)`. */
export const GATE_RULES: Readonly<Record<number, { id: string; name: string; requirement: string }>> =
  Object.freeze({
    1: {
      id: "G1",
      name: "Envelope",
      requirement:
        'the version must be "1.1", the type a registered resource type, the chain name lowercase letters, digits and hyphens, the network mainnet, testnet or devnet, and the entity type empty, individual or organization',
    },
    2: {
      id: "G2",
      name: "Field limits",
      requirement: "every string, the metadata and the signature must be within their size limits",
    },
    3: {
      id: "G3",
      name: "Text safety",
      requirement:
        "no string, and no part of the metadata, may contain control, bidirectional, invisible, exotic-space or private-use characters",
    },
    4: {
      id: "G4",
      name: "Identifier grammar",
      requirement: "the identifier must be written in the one spelling its type and chain allow",
    },
    5: {
      id: "G5",
      name: "Alias grammar",
      requirement: "the alias must be empty or lowercase letters, digits and hyphens ending in .nota",
    },
    6: {
      id: "G6",
      name: "Display strings",
      requirement:
        'names and descriptions must not begin or end with a space, contain two spaces in a row, contain "://", or contain 0x followed by eight or more hex digits',
    },
    7: {
      id: "G7",
      name: "Metadata binding",
      requirement: "metadataHash must be the hash of the metadata, and the metadata must be one well-formed JSON object",
    },
    8: {
      id: "G8",
      name: "Time window",
      requirement:
        "issuedAt must be within 24 hours before and 15 minutes after the registry chain's clock, and expiresAt must be zero or in the future",
    },
    9: {
      id: "G9",
      name: "Signature",
      requirement: "the signature must be the issuer account's signature of this exact content",
    },
    10: {
      id: "G10",
      name: "Uniqueness",
      requirement: "this exact content has already been minted",
    },
    11: {
      id: "G11",
      name: "Succession",
      requirement:
        "supersedes must name the issuer's current file for this resource (or be zero when there is none), and that file must not be awaiting verification or under dispute",
    },
    12: {
      id: "G12",
      name: "Denylist",
      requirement: "the resource or the issuer is on the registry denylist",
    },
    13: {
      id: "G13",
      name: "Alias availability",
      requirement:
        "the alias is bound to another resource or issuer, or this issuer's files for the resource already carry a different alias",
    },
  });

/** What a gate rule requires, for display. Falls back to a generic sentence for an unknown number. */
export function describeGateRule(rule: number): string {
  return GATE_RULES[rule]?.requirement ?? `the content was refused by rule ${rule}`;
}

// ---------------------------------------------------------------------------
// Calldata
// ---------------------------------------------------------------------------

/**
 * The Solidity `Nota` struct. `type_` and `alias_` carry a trailing underscore
 * because the names are reserved words in Solidity.
 */
export interface NotaStruct {
  version: string;
  type_: string;
  chain: { name: string; chainId: bigint; network: string };
  resource: { identifier: string; name: string; alias_: string; description: string };
  issuer: { account: string; name: string; entityType: string };
  metadataHash: string;
  supersedes: string;
  issuedAt: bigint;
  expiresAt: bigint;
}

/** Converts the content layer into the struct `mint` and `check` take. */
export function toNotaStruct(content: NotaContent): NotaStruct {
  return {
    version: content.version,
    type_: content.type,
    chain: {
      name: content.chain.name,
      chainId: BigInt(content.chain.chainId),
      network: content.chain.network,
    },
    resource: {
      identifier: content.resource.identifier,
      name: content.resource.name,
      alias_: content.resource.alias,
      description: content.resource.description,
    },
    issuer: {
      account: content.issuer.account,
      name: content.issuer.name,
      entityType: content.issuer.entityType,
    },
    metadataHash: content.metadataHash,
    supersedes: content.supersedes,
    issuedAt: BigInt(content.issuedAt),
    expiresAt: BigInt(content.expiresAt),
  };
}

/** Bytes as lowercase `0x` hex; `"0x"` for none. */
export function bytesToHexString(bytes: Uint8Array | null | undefined): string {
  if (bytes === null || bytes === undefined) return "0x";
  let out = "0x";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

/**
 * The arguments of `mint(nota, metadata, signature)` and of the gate's
 * `check`, in order. Pass `"0x"` (or nothing) as the signature for an unsigned
 * preflight.
 */
export function mintArguments(
  draft: NotaDraft,
  signature: NotaSignature | string = "0x"
): readonly [NotaStruct, string, string] {
  const signatureHex = typeof signature === "string" ? signature : signature.signature;
  if (!/^0x([0-9a-fA-F]{2})*$/.test(signatureHex)) {
    throw new NotaSignatureError("The signature must be 0x plus an even number of hex digits.");
  }
  return [toNotaStruct(draft.content), bytesToHexString(draft.metadata), signatureHex.toLowerCase()];
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/** EIP-712 typed data for the content layer, in the shape wallets take. */
export interface NotaTypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  types: Record<string, TypedDataField[]>;
  primaryType: "Nota";
  /** The content layer itself: the JSON object is exactly the EIP-712 message. */
  message: NotaContent;
}

/**
 * Builds the EIP-712 request the issuer signs. Its digest is the `notaId`.
 *
 * @throws NotaConformanceError if the content does not conform; nothing the
 *   gate would refuse is offered for signing.
 */
export function notaTypedData(content: NotaContent, registry: RegistryDeployment): NotaTypedData {
  computeNotaId(content, registry); // validates the content and the deployment
  const domain = notaDomain(registry);
  return {
    domain: {
      name: String(domain.name),
      version: String(domain.version),
      chainId: registry.chainId,
      verifyingContract: registry.address,
    },
    types: NOTA_EIP712_TYPES,
    primaryType: NOTA_EIP712_PRIMARY_TYPE as "Nota",
    message: content,
  };
}

/**
 * Turns what a wallet returned from `eth_signTypedData_v4` into a `SIGN`
 * payload.
 *
 * For an externally owned account the signature is normalized (`v` of 27 or
 * 28, lowercase) and must recover to `issuer.account`. For a contract account
 * (`issuerHasCode`) the bytes are kept as the account's ERC-1271 signature,
 * which only the gate can check.
 *
 * @throws NotaSignatureError if the signature is malformed or is not the issuer's.
 */
export function signatureFromWallet(
  raw: string,
  content: NotaContent,
  registry: RegistryDeployment,
  issuerHasCode: boolean
): NotaSignature {
  if (issuerHasCode) {
    return buildSignature({ signature: raw, signer: content.issuer.account, scheme: "erc1271" });
  }
  let serialized: string;
  try {
    serialized = Signature.from(raw).serialized;
  } catch (err) {
    throw new NotaSignatureError(
      `The wallet returned a malformed signature: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const signature = buildSignature({
    signature: serialized,
    signer: content.issuer.account,
    scheme: "eip712-secp256k1",
  });
  if (!verifyNotaSignature(content, registry, signature)) {
    throw new NotaSignatureError(
      `The signature is not from issuer.account (${content.issuer.account}). The issuer account must sign its own content.`
    );
  }
  return signature;
}

/** Accepts a `SIGN` payload or bare signature bytes and returns the payload. */
export function toNotaSignature(
  signature: NotaSignature | string,
  content: NotaContent,
  registry: RegistryDeployment,
  issuerHasCode: boolean
): NotaSignature {
  if (typeof signature === "string") return signatureFromWallet(signature, content, registry, issuerHasCode);
  return validateSignature(signature);
}

// ---------------------------------------------------------------------------
// The NotaMinted event
// ---------------------------------------------------------------------------

const registryInterface = new Interface(NotareumNotaRegistryABI);

/** Topic 0 of `NotaMinted`. */
export const NOTA_MINTED_TOPIC: string = registryInterface.getEvent("NotaMinted")!.topicHash;

/**
 * A log as returned by ethers (`index`) or viem (`logIndex`), or decoded from
 * JSON-RPC. Only these members are read.
 */
export interface MintLog {
  address?: string;
  topics: readonly string[];
  data: string;
  blockNumber: number | bigint | null;
  transactionHash: string | null;
  index?: number;
  logIndex?: number | bigint | null;
}

function sameAddress(a: string | undefined, b: string): boolean {
  return a !== undefined && a.toLowerCase() === b.toLowerCase();
}

/**
 * Finds the `NotaMinted` log the given registry emitted. Logs from any other
 * address are ignored, so a contract that emits a look-alike event in the same
 * transaction cannot supply the file's content.
 */
export function findNotaMintedLog<L extends MintLog>(
  logs: readonly L[],
  registryAddress: string,
  notaId?: string
): L | null {
  for (const log of logs) {
    if (!sameAddress(log.address, registryAddress)) continue;
    if (log.topics[0] !== NOTA_MINTED_TOPIC) continue;
    if (notaId !== undefined && log.topics[1]?.toLowerCase() !== notaId.toLowerCase()) continue;
    return log;
  }
  return null;
}

function logPosition(log: MintLog): { blockNumber: number; transactionHash: string; logIndex: number } {
  const index = log.index ?? log.logIndex;
  if (log.blockNumber === null || log.transactionHash === null || index === null || index === undefined) {
    throw new Error("The NotaMinted log has not been mined yet: it has no block, transaction or index.");
  }
  return {
    blockNumber: Number(log.blockNumber),
    transactionHash: log.transactionHash,
    logIndex: Number(index),
  };
}

/** Decodes a `NotaMinted` log into the event fields core's writer takes. */
export function decodeNotaMintedLog(log: MintLog): NotaMintedEvent {
  const parsed = registryInterface.parseLog({ topics: [...log.topics], data: log.data });
  if (parsed === null || parsed.name !== "NotaMinted") {
    throw new Error("The log is not a NotaMinted event.");
  }
  return parsed.args.toObject(true) as unknown as NotaMintedEvent;
}

/**
 * Summarizes a `NotaMinted` log without validating its content, for listings.
 * Use {@link notaFileFromMintLog} to obtain the file itself.
 */
export function summarizeNotaMintedLog(log: MintLog): MintedNota {
  const event = decodeNotaMintedLog(log);
  const nota = event.nota;
  return {
    notaId: event.notaId.toLowerCase(),
    resourceId: event.resourceId.toLowerCase(),
    issuer: getAddress(event.issuer),
    ruleset: Number(event.ruleset),
    controlProof: controlProofName(event.controlProof),
    type: String(nota.type_ ?? nota.type ?? ""),
    chain: {
      name: nota.chain.name,
      chainId: BigInt(nota.chain.chainId),
      network: nota.chain.network,
    },
    identifier: nota.resource.identifier,
    name: nota.resource.name,
    alias: String(nota.resource.alias_ ?? nota.resource.alias ?? ""),
    description: nota.resource.description,
    issuerName: nota.issuer.name,
    supersedes: nota.supersedes.toLowerCase(),
    issuedAt: Number(nota.issuedAt),
    expiresAt: Number(nota.expiresAt),
    ...logPosition(log),
  };
}

/** What the chain says about a mint besides the log itself. */
export interface MintContext {
  /** The pinned registry deployment the log came from. */
  registry: RegistryDeployment;
  /** Timestamp of the block that included the mint. */
  blockTimestamp: number | bigint;
  /**
   * Whether `issuer.account` had code on the registry chain when the file was
   * minted. The gate checks a contract account's signature through ERC-1271,
   * and the file records that as its signature scheme.
   */
  issuerHasCode: boolean;
}

/**
 * Writes revision 0 of a `.nota` file from its `NotaMinted` log: the last step
 * of the mint flow, and how a lost file is recovered from the chain. Call it
 * only once the mint is final.
 *
 * The result is verified with the strict reader before it is returned.
 *
 * @throws NotaConformanceError or NotaContainerError if the log does not
 *   describe a valid file.
 */
export function notaFileFromMintLog(log: MintLog, context: MintContext): Uint8Array {
  if (log.address !== undefined && !sameAddress(log.address, context.registry.address)) {
    throw new Error(
      `The log was emitted by ${log.address}, not by the registry ${context.registry.address}.`
    );
  }
  const position = logPosition(log);
  return reconstructFromMintEvent(decodeNotaMintedLog(log), {
    registry: context.registry,
    transactionHash: position.transactionHash,
    blockNumber: position.blockNumber,
    logIndex: position.logIndex,
    blockTimestamp: context.blockTimestamp,
    issuerHasCode: context.issuerHasCode,
  });
}

/** A file name to offer for a minted file: its alias, or the start of its `notaId`. */
export function suggestNotaFileName(content: NotaContent, notaId: string): string {
  const alias = content.resource.alias;
  if (alias !== "") return alias; // already ends in .nota (gate rule G5)
  return `${notaId.slice(0, 18)}${NOTA_FILE_EXTENSION}`;
}
