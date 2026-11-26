/**
 * The worked example of protocol/v1.1/01-nota-format.md: both example files
 * read, and this implementation reproduces them byte for byte.
 */

import { describe, it, expect } from "vitest";
import { Interface, Wallet, keccak256 } from "ethers";
import { bytesToHex, readContainer } from "../../../src/core/container/index.js";
import {
  NOTA_EIP712_TYPE_HASH,
  computeNotaId,
  signNotaContent,
} from "../../../src/core/crypto/index.js";
import { canonicalize } from "../../../src/core/json/index.js";
import {
  NOTA_MINTED_EVENT_ABI,
  appendAnnex,
  buildReceipt,
  buildStatusSnapshot,
  collapseAnnexes,
  computeMetadataHash,
  computeNotaResourceId,
  encodeMetadata,
  extractMintedBody,
  readNota,
  reconstructFromMintEvent,
  writeNota,
} from "../../../src/core/nota/index.js";
import {
  EXAMPLE_FILE_HASH,
  EXAMPLE_HEADER_HEX,
  EXAMPLE_METADATA,
  EXAMPLE_METADATA_HASH,
  EXAMPLE_MINT,
  EXAMPLE_NOTA_ID,
  EXAMPLE_RESOURCE_ID,
  EXAMPLE_TYPE_HASH,
  ISSUER,
  REGISTRY,
  TEST_PRIVATE_KEY,
  exampleContent,
  exampleReceipt,
  exampleStatus,
  loadExample,
} from "../fixtures.js";

const registered = loadExample("address-registered.nota");
const verified = loadExample("address-verified.nota");

async function rebuildRevision0(): Promise<Uint8Array> {
  const content = exampleContent();
  const signature = await signNotaContent(content, REGISTRY, TEST_PRIVATE_KEY);
  const receipt = buildReceipt({
    registry: REGISTRY,
    notaId: computeNotaId(content, REGISTRY),
    resourceId: computeNotaResourceId(content),
    ...EXAMPLE_MINT,
  });
  return writeNota({ content, metadata: EXAMPLE_METADATA, signature, receipt });
}

describe("spec example: address-registered.nota", () => {
  it("is the file the spec describes", () => {
    expect(registered.length).toBe(1521);
    expect(keccak256(registered)).toBe(EXAMPLE_FILE_HASH);
  });

  it("reads strictly", () => {
    const nota = readNota(registered);
    expect(nota.state).toBe("unconfirmed");
    expect(nota.versionMinor).toBe(1);
    expect(nota.content).toEqual(exampleContent());
    expect(nota.metadata).toEqual(EXAMPLE_METADATA);
    expect(nota.signature.scheme).toBe("eip712-secp256k1");
    expect(nota.signature.signer).toBe(ISSUER);
    expect(nota.signatureVerified).toBe(true);
    expect(nota.receipt).toEqual(exampleReceipt());
    expect(nota.notaId).toBe(EXAMPLE_NOTA_ID);
    expect(nota.resourceId).toBe(EXAMPLE_RESOURCE_ID);
    expect(nota.annexObjects).toEqual([]);
    expect(nota.statusSnapshot).toBeNull();
    expect(nota.registryPinned).toBe(false);
    expect(nota.fileHash).toBe(EXAMPLE_FILE_HASH);
  });

  it("has the layout of the worked-example table", () => {
    const container = readContainer(registered);
    expect(bytesToHex(registered.subarray(0, 16))).toBe(EXAMPLE_HEADER_HEX);
    expect(container.revisions).toHaveLength(1);
    const rev = container.revisions[0];
    expect(rev.objects.map((o) => [o.type, o.number, o.offset, o.length])).toEqual([
      ["CONT", 1, 16, 616],
      ["META", 2, 648, 21],
      ["SIGN", 3, 685, 230],
      ["RCPT", 4, 931, 426],
    ]);
    expect([rev.xrefNumber, rev.xrefOffset]).toEqual([5, 1373]);
    expect(rev.trailerOffset).toBe(1457);
    expect(rev.prevTrailer).toBe(0);
    expect(rev.size).toBe(1521);
  });

  it("yields the documented hashes", () => {
    const content = exampleContent();
    expect(NOTA_EIP712_TYPE_HASH).toBe(EXAMPLE_TYPE_HASH);
    expect(computeMetadataHash(encodeMetadata(EXAMPLE_METADATA))).toBe(EXAMPLE_METADATA_HASH);
    expect(computeNotaId(content, REGISTRY)).toBe(EXAMPLE_NOTA_ID);
    expect(computeNotaResourceId(content)).toBe(EXAMPLE_RESOURCE_ID);
  });

  it("stores the content as canonical JSON", () => {
    const cont = readContainer(registered).revisions[0].objects[0];
    expect(new TextDecoder().decode(cont.payload)).toBe(canonicalize(exampleContent()));
  });

  it("is reproduced byte for byte by rebuilding revision 0 from the example content", async () => {
    const rebuilt = await rebuildRevision0();
    expect(keccak256(rebuilt)).toBe(EXAMPLE_FILE_HASH);
    expect(Buffer.from(rebuilt).equals(Buffer.from(registered))).toBe(true);
    expect(readNota(rebuilt).notaId).toBe(EXAMPLE_NOTA_ID);
  });

  it("is reproduced byte for byte from the fields of its NotaMinted event", async () => {
    // Encode the event as the registry would emit it, decode it as an SDK
    // would, and reconstruct the file from the decoded log alone.
    const content = exampleContent();
    const { signature } = await signNotaContent(content, REGISTRY, new Wallet(TEST_PRIVATE_KEY));
    const iface = new Interface([NOTA_MINTED_EVENT_ABI]);
    const fragment = iface.getEvent("NotaMinted")!;
    const struct = {
      version: content.version,
      type_: content.type,
      chain: content.chain,
      resource: {
        identifier: content.resource.identifier,
        name: content.resource.name,
        alias_: content.resource.alias,
        description: content.resource.description,
      },
      issuer: content.issuer,
      metadataHash: content.metadataHash,
      supersedes: content.supersedes,
      issuedAt: content.issuedAt,
      expiresAt: content.expiresAt,
    };
    const log = iface.encodeEventLog(fragment, [
      EXAMPLE_NOTA_ID,
      EXAMPLE_RESOURCE_ID,
      ISSUER,
      1,
      1, // ControlProof.SELF
      struct,
      encodeMetadata(EXAMPLE_METADATA),
      signature,
    ]);
    const parsed = iface.parseLog(log)!;

    const rebuilt = reconstructFromMintEvent(parsed.args as never, {
      registry: REGISTRY,
      transactionHash: EXAMPLE_MINT.transactionHash,
      blockNumber: BigInt(EXAMPLE_MINT.blockNumber),
      logIndex: EXAMPLE_MINT.logIndex,
      blockTimestamp: BigInt(EXAMPLE_MINT.mintedAt),
      issuerHasCode: false,
    });
    expect(keccak256(rebuilt)).toBe(EXAMPLE_FILE_HASH);
  });
});

describe("spec example: address-verified.nota", () => {
  it("reads strictly, with its STAT annex", () => {
    const nota = readNota(verified);
    expect(verified.length).toBe(1847);
    expect(nota.notaId).toBe(EXAMPLE_NOTA_ID);
    expect(nota.container.revisions).toHaveLength(2);
    expect(nota.annexObjects).toEqual([
      { type: "STAT", number: 6, revision: 1, snapshot: exampleStatus() },
    ]);
    expect(nota.statusSnapshot).toEqual(exampleStatus());
    // An annex is a cached snapshot. The file is still unconfirmed.
    expect(nota.state).toBe("unconfirmed");
  });

  it("has the layout of the worked-example table", () => {
    const [rev0, rev1] = readContainer(verified).revisions;
    expect(rev0.trailerOffset).toBe(1457);
    expect(rev1.offset).toBe(1521);
    expect(rev1.objects.map((o) => [o.type, o.number, o.offset, o.length])).toEqual([
      ["STAT", 6, 1521, 210],
    ]);
    expect([rev1.xrefNumber, rev1.xrefOffset]).toEqual([7, 1747]);
    expect(rev1.trailerOffset).toBe(1783);
    expect(rev1.prevTrailer).toBe(1457);
  });

  it("leaves the minted body untouched: revision 0 is address-registered.nota", () => {
    expect(Buffer.from(verified.subarray(0, 1521)).equals(Buffer.from(registered))).toBe(true);
    expect(Buffer.from(extractMintedBody(verified)).equals(Buffer.from(registered))).toBe(true);
    expect(readContainer(verified).revisions[0].digest).toBe(
      readContainer(registered).revisions[0].digest
    );
  });

  it("is reproduced byte for byte by appending the STAT annex", () => {
    const snapshot = buildStatusSnapshot({
      asOfBlock: 7660000,
      asOfTime: 1795650000,
      status: "verified",
      request: {
        level: "basic",
        requestId: 42,
        approvals: 3,
        rejections: 0,
        transactionHash: "0x" + "cd".repeat(32),
      },
    });
    const appended = appendAnnex(registered, [{ type: "STAT", snapshot }]);
    expect(Buffer.from(appended).equals(Buffer.from(verified))).toBe(true);
  });

  it("collapses to itself, since it holds one current snapshot", () => {
    expect(Buffer.from(collapseAnnexes(verified)).equals(Buffer.from(verified))).toBe(true);
  });
});
