/**
 * Shared fixtures for the v1.1 tests: the worked example of
 * protocol/v1.1/01-nota-format.md, and helpers for crafting containers.
 *
 * The values mirror protocol/v1.1/examples/generate-example.mjs. The signing
 * key is Hardhat's well-known test account #0; it is public.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256 } from "ethers";
import {
  appendRevision,
  encodeHeader,
  encodeObject,
  encodeTrailer,
  encodeXrefPayload,
  concatBytes,
  hexToBytes,
  readContainer,
} from "../../src/core/container/index.js";
import type { ObjectInput, XrefEntry } from "../../src/core/container/index.js";
import { canonicalBytes } from "../../src/core/json/index.js";
import type {
  NotaContent,
  NotaReceipt,
  NotaSignature,
  NotaStatusSnapshot,
  RegistryDeployment,
} from "../../src/core/nota/index.js";

const here = dirname(fileURLToPath(import.meta.url));

/** The spec's example directory. Override with NOTA_SPEC_EXAMPLES when the repos are not siblings. */
export const EXAMPLES_DIR =
  process.env.NOTA_SPEC_EXAMPLES ?? resolve(here, "./examples");

export function loadExample(name: "address-registered.nota" | "address-verified.nota"): Uint8Array {
  const path = join(EXAMPLES_DIR, name);
  if (!existsSync(path)) {
    throw new Error(
      `Spec example not found: ${path}. Check out the protocol repo next to core, or set NOTA_SPEC_EXAMPLES.`
    );
  }
  return new Uint8Array(readFileSync(path));
}

export const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const ISSUER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const ZERO32 = "0x" + "00".repeat(32);

export const REGISTRY: RegistryDeployment = {
  chainId: 11155111,
  address: "0x0000000000000000000000000000000000001101",
};

export const EXAMPLE_METADATA = { tags: ["treasury"] };
export const EXAMPLE_METADATA_HASH =
  "0xfec7845fe0e94f248568afe4d26e53b1c6cfbd643d12afdad01a8f6481a68604";
export const EXAMPLE_NOTA_ID =
  "0x74820ee3bb5ccaf696c2792f648c4e4c931ea37415a3956c381592e00e42da95";
export const EXAMPLE_RESOURCE_ID =
  "0x5e7876f6a775c7aa6499eeea02810c9278554263c4596e5d980d3ea9ce6739f1";
export const EXAMPLE_TYPE_HASH =
  "0x101cebe40001c1f920d6879c790953bf9ee100de676d84700a6991c9fe9263e0";
export const EXAMPLE_FILE_HASH =
  "0x2a092e93eb35d7bbab27b3a6de291034d0b5eb965add0dea9bfcaf06d4ebd89b";
export const EXAMPLE_HEADER_HEX = "0x894e4f54410d0a1a0a0101003ac55944";

export function exampleContent(): NotaContent {
  return {
    version: "1.1",
    type: "address",
    chain: { name: "ethereum", chainId: 1, network: "mainnet" },
    resource: {
      identifier: ISSUER,
      name: "Example Treasury",
      alias: "example-treasury.nota",
      description: "Example receive address for the v1.1 container test vector",
    },
    issuer: { account: ISSUER, name: "Example Labs", entityType: "organization" },
    metadataHash: EXAMPLE_METADATA_HASH,
    supersedes: ZERO32,
    issuedAt: 1795564800,
    expiresAt: 0,
  };
}

/** Content with no metadata, for tests that vary fields and re-sign. */
export function plainContent(overrides: Partial<NotaContent> = {}): NotaContent {
  return { ...exampleContent(), metadataHash: ZERO32, ...overrides };
}

export const EXAMPLE_MINT = {
  transactionHash: "0x" + "ab".repeat(32),
  blockNumber: 7654321,
  logIndex: 4,
  mintedAt: 1795564812,
  ruleset: 1,
  controlProof: "self" as const,
};

export function exampleReceipt(overrides: Partial<NotaReceipt> = {}): NotaReceipt {
  return {
    registry: { ...REGISTRY },
    notaId: EXAMPLE_NOTA_ID,
    resourceId: EXAMPLE_RESOURCE_ID,
    ruleset: EXAMPLE_MINT.ruleset,
    controlProof: EXAMPLE_MINT.controlProof,
    transactionHash: EXAMPLE_MINT.transactionHash,
    blockNumber: EXAMPLE_MINT.blockNumber,
    logIndex: EXAMPLE_MINT.logIndex,
    mintedAt: EXAMPLE_MINT.mintedAt,
    ...overrides,
  };
}

export function exampleStatus(overrides: Partial<NotaStatusSnapshot> = {}): NotaStatusSnapshot {
  return {
    asOfBlock: 7660000,
    asOfTime: 1795650000,
    status: "verified",
    level: "basic",
    requestId: 42,
    approvals: 3,
    rejections: 0,
    transactionHash: "0x" + "cd".repeat(32),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Container crafting
// ---------------------------------------------------------------------------

/** The four objects of the example's revision 0, as writer input. */
export function exampleObjects(): ObjectInput[] {
  const container = readContainer(loadExample("address-registered.nota"));
  return container.revisions[0].objects.map((o) => ({
    type: o.type,
    number: o.number,
    payload: o.payload.slice(),
  }));
}

export interface RevisionSpec {
  objects: ObjectInput[];
  xrefNumber: number;
  /** Revision number to write. Defaults to the position in the list. */
  revision?: number;
}

/**
 * Encodes a container from revisions with the unchecked low-level writer.
 * Structure, CRCs, sizes and digests are always consistent; what the
 * revisions hold is up to the test.
 */
export function buildContainer(revisions: RevisionSpec[], header: Uint8Array = encodeHeader()): Uint8Array {
  let file = header;
  let prevTrailer = 0;
  revisions.forEach((r, i) => {
    const out = appendRevision(file, {
      revision: r.revision ?? i,
      prevTrailer,
      objects: r.objects,
      xrefNumber: r.xrefNumber,
    });
    file = out.file;
    prevTrailer = out.trailerOffset;
  });
  return file;
}

/** A valid revision 0 built from the example objects, with one of them replaced. */
export function mintedBodyWith(replace: Partial<Record<string, Uint8Array | null>> = {}): Uint8Array {
  const objects = exampleObjects()
    .filter((o) => replace[o.type] !== null)
    .map((o) => ({ ...o, payload: replace[o.type] ?? o.payload }));
  return buildContainer([{ objects, xrefNumber: 5 }]);
}

/** The example's revision 0 followed by one annex revision holding `objects`. */
export function withAnnex(objects: ObjectInput[], xrefNumber?: number): Uint8Array {
  const last = objects.length > 0 ? objects[objects.length - 1].number : 5;
  return buildContainer([
    { objects: exampleObjects(), xrefNumber: 5 },
    { objects, xrefNumber: xrefNumber ?? last + 1 },
  ]);
}

export const jsonPayload = (value: unknown): Uint8Array => canonicalBytes(value);
export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * Lays out revision 0 by hand: `segments` are written in order after the
 * header, `entries` become the XREF table, and the trailer is sealed with a
 * correct size, digest and CRC. Lets a test place gaps and overlaps.
 */
export function layoutRevision0(
  segments: Uint8Array[],
  entries: XrefEntry[],
  options: { afterXref?: Uint8Array; xrefNumber?: number } = {}
): Uint8Array {
  const head = concatBytes([encodeHeader(), ...segments]);
  const xrefOffset = head.length;
  const xref = encodeObject("XREF", options.xrefNumber ?? 5, encodeXrefPayload(entries));
  const body = concatBytes([head, xref, options.afterXref ?? new Uint8Array(0)]);
  const trailer = encodeTrailer({
    revision: 0,
    xrefOffset,
    prevTrailer: 0,
    size: body.length + 64,
    digest: hexToBytes(keccak256(body)),
  });
  return concatBytes([body, trailer]);
}

/** Replaces the final trailer of a single-revision file, recomputing digest and CRC. */
export function resealRevision0(
  file: Uint8Array,
  fields: Partial<{ revision: number; xrefOffset: number; prevTrailer: number; size: number }> = {}
): Uint8Array {
  const body = file.slice(0, file.length - 64);
  const view = new DataView(file.buffer, file.byteOffset + file.length - 64, 64);
  const trailer = encodeTrailer({
    revision: fields.revision ?? view.getUint32(4),
    xrefOffset: fields.xrefOffset ?? view.getUint32(8),
    prevTrailer: fields.prevTrailer ?? view.getUint32(12),
    size: fields.size ?? body.length + 64,
    digest: hexToBytes(keccak256(body)),
  });
  return concatBytes([body, trailer]);
}

export function signatureOf(file: Uint8Array): NotaSignature {
  const sign = readContainer(file).revisions[0].objects.find((o) => o.type === "SIGN");
  return sign!.json as unknown as NotaSignature;
}
