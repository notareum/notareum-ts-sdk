/**
 * Whole-file reading and writing: the offline trust rules (recompute, check
 * the signature, pinned registries), revision 0, annexes, and reconstruction
 * from a NotaMinted event.
 */

import { describe, it, expect } from "vitest";
import { Wallet } from "ethers";
import { readContainer } from "../../../src/core/container/index.js";
import type { ObjectInput } from "../../../src/core/container/index.js";
import { computeNotaId, signNotaContent } from "../../../src/core/crypto/index.js";
import { NotaConformanceError, NotaContainerError } from "../../../src/core/errors.js";
import {
  appendAnnex,
  buildReceipt,
  collapseAnnexes,
  computeMetadataHash,
  computeNotaResourceId,
  contentFromMintedStruct,
  deriveControlProof,
  encodeMetadata,
  extractMintedBody,
  readNota,
  reconstructFromMintEvent,
  writeNota,
} from "../../../src/core/nota/index.js";
import type {
  NotaContent,
  NotaReceipt,
  NotaSignature,
  NotaStatusSnapshot,
} from "../../../src/core/nota/index.js";
import {
  EXAMPLE_METADATA,
  EXAMPLE_MINT,
  ISSUER,
  REGISTRY,
  TEST_PRIVATE_KEY,
  ZERO32,
  buildContainer,
  exampleContent,
  exampleStatus,
  jsonPayload,
  loadExample,
  plainContent,
  utf8,
} from "../fixtures.js";

const registered = loadExample("address-registered.nota");
const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // Hardhat #1, public
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

interface Parts {
  content: NotaContent;
  metadata: Uint8Array | null;
  signature: NotaSignature;
  receipt: NotaReceipt;
}

/** Signs and "mints" content with the test key, returning the parts of a valid file. */
async function mintParts(
  content: NotaContent,
  metadata: Record<string, unknown> | null = null,
  receiptOverrides: Partial<NotaReceipt> = {}
): Promise<Parts> {
  const metadataBytes = metadata === null ? null : encodeMetadata(metadata);
  const full = { ...content, metadataHash: computeMetadataHash(metadataBytes) };
  const signature = await signNotaContent(full, REGISTRY, TEST_PRIVATE_KEY);
  const receipt = buildReceipt({
    registry: REGISTRY,
    notaId: computeNotaId(full, REGISTRY),
    resourceId: computeNotaResourceId(full),
    ...EXAMPLE_MINT,
    controlProof: deriveControlProof(full, signature.scheme, REGISTRY),
    ...receiptOverrides,
  });
  return { content: full, metadata: metadataBytes, signature, receipt };
}

/** Assembles revision 0 from parts without any checking, so a test can break one thing. */
function assemble(parts: {
  content: unknown;
  metadata?: Uint8Array | null;
  signature: unknown;
  receipt: unknown;
}): Uint8Array {
  const objects: ObjectInput[] = [{ type: "CONT", number: 1, payload: jsonPayload(parts.content) }];
  if (parts.metadata) objects.push({ type: "META", number: 2, payload: parts.metadata });
  objects.push(
    { type: "SIGN", number: 3, payload: jsonPayload(parts.signature) },
    { type: "RCPT", number: 4, payload: jsonPayload(parts.receipt) }
  );
  return buildContainer([{ objects, xrefNumber: 5 }]);
}

function expectRule(run: () => unknown, rule: string, field?: string): void {
  let caught: unknown;
  try {
    run();
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected ${rule}, but nothing was thrown`).toBeInstanceOf(NotaConformanceError);
  expect((caught as NotaConformanceError).rule).toBe(rule);
  if (field !== undefined) expect((caught as NotaConformanceError).field).toBe(field);
}

describe("writeNota and readNota", () => {
  it("round-trips a file with metadata", async () => {
    const parts = await mintParts(plainContent(), { tags: ["a", "b"], ens: "example.eth" });
    const file = writeNota(parts);
    const nota = readNota(file);
    expect(nota.content).toEqual(parts.content);
    expect(nota.metadata).toEqual({ tags: ["a", "b"], ens: "example.eth" });
    expect(nota.signature).toEqual(parts.signature);
    expect(nota.receipt).toEqual(parts.receipt);
    expect(nota.signatureVerified).toBe(true);
    expect(nota.container.revisions[0].objects.map((o) => o.number)).toEqual([1, 2, 3, 4]);
  });

  it("leaves object number 2 unused when there is no metadata", async () => {
    const parts = await mintParts(plainContent());
    const file = writeNota(parts);
    const rev = readContainer(file).revisions[0];
    expect(rev.objects.map((o) => [o.type, o.number])).toEqual([
      ["CONT", 1],
      ["SIGN", 3],
      ["RCPT", 4],
    ]);
    expect(rev.xrefNumber).toBe(5);
    expect(readNota(file).metadata).toBeNull();
    // null, undefined and zero bytes all mean "no metadata".
    for (const metadata of [undefined, null, new Uint8Array(0)]) {
      expect(Buffer.from(writeNota({ ...parts, metadata })).equals(Buffer.from(file))).toBe(true);
    }
  });

  it("is deterministic: the same mint gives the same bytes", async () => {
    const a = writeNota(await mintParts(plainContent(), { tags: ["x"] }));
    const b = writeNota(await mintParts(plainContent(), { tags: ["x"] }));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("writes metadata bytes verbatim and metadata objects canonically", async () => {
    const parts = await mintParts(plainContent(), { b: 1, a: 2 });
    const fromBytes = writeNota(parts);
    const fromObject = writeNota({ ...parts, metadata: { b: 1, a: 2 } });
    expect(Buffer.from(fromBytes).equals(Buffer.from(fromObject))).toBe(true);
    expect(new TextDecoder().decode(readNota(fromBytes).metadataBytes!)).toBe('{"a":2,"b":1}');
  });

  it("never writes a file its reader would refuse", async () => {
    const parts = await mintParts(plainContent());
    // Non-conforming content.
    expectRule(() => writeNota({ ...parts, content: { ...parts.content, version: "1.0" } }), "G1");
    // A receipt for different content.
    expectRule(() => writeNota({ ...parts, receipt: { ...parts.receipt, notaId: ZERO32 } }), "RECEIPT");
    // Metadata the content does not commit to.
    expectRule(() => writeNota({ ...parts, metadata: { added: "later" } }), "G7");
    // Metadata bytes that are not canonical.
    expect(() => writeNota({ ...parts, metadata: utf8('{"b":1, "a":2}') })).toThrow(NotaContainerError);
    // No receipt: content that has not been minted is a draft, not a .nota file.
    expectRule(() => writeNota({ ...parts, receipt: undefined as never }), "RECEIPT");
    expectRule(() => writeNota({ ...parts, signature: undefined as never }), "SIGNATURE");
  });
});

describe("trust rule 2: recompute and compare with the receipt", () => {
  it("rejects content changed after signing, even with a matching receipt", async () => {
    // The attacker edits the name and recomputes the receipt honestly. The
    // signature no longer recovers to the issuer.
    const parts = await mintParts(plainContent());
    const content = { ...parts.content, resource: { ...parts.content.resource, name: "Attacker" } };
    const receipt = { ...parts.receipt, notaId: computeNotaId(content, REGISTRY) };
    expectRule(() => readNota(assemble({ ...parts, content, receipt })), "G9", "SIGN.signature");
  });

  it("rejects content changed after signing with the original receipt", async () => {
    const parts = await mintParts(plainContent());
    const content = { ...parts.content, resource: { ...parts.content.resource, name: "Attacker" } };
    expectRule(() => readNota(assemble({ ...parts, content })), "RECEIPT", "RCPT.notaId");
  });

  it("covers type and chain, which v1.0 left outside the signature", async () => {
    const parts = await mintParts(plainContent());
    for (const content of [
      { ...parts.content, type: "contract" },
      { ...parts.content, chain: { ...parts.content.chain, chainId: 137 } },
      { ...parts.content, chain: { ...parts.content.chain, network: "testnet" } },
      { ...parts.content, expiresAt: 1999999999 },
    ]) {
      expectRule(() => readNota(assemble({ ...parts, content })), "RECEIPT");
    }
  });

  it("rejects a receipt that names a different registry", async () => {
    // The domain binds notaId to one deployment: under any other, the id differs.
    const parts = await mintParts(plainContent());
    for (const registry of [
      { chainId: 1, address: REGISTRY.address },
      { chainId: REGISTRY.chainId, address: "0x0000000000000000000000000000000000002202" },
    ]) {
      expectRule(
        () => readNota(assemble({ ...parts, receipt: { ...parts.receipt, registry } })),
        "RECEIPT",
        "RCPT.notaId"
      );
    }
  });

  it("rejects a wrong resourceId", async () => {
    const parts = await mintParts(plainContent());
    const receipt = { ...parts.receipt, resourceId: "0x" + "11".repeat(32) };
    expectRule(() => readNota(assemble({ ...parts, receipt })), "RECEIPT", "RCPT.resourceId");
  });

  it("rejects metadata that does not match metadataHash", async () => {
    const parts = await mintParts(plainContent(), { tags: ["treasury"] });
    // Replaced metadata.
    expectRule(
      () => readNota(assemble({ ...parts, metadata: encodeMetadata({ tags: ["attacker"] }) })),
      "G7",
      "metadataHash"
    );
    // Removed metadata.
    expectRule(() => readNota(assemble({ ...parts, metadata: null })), "G7", "metadataHash");
    // Added metadata on a file that committed to none.
    const bare = await mintParts(plainContent());
    expectRule(
      () => readNota(assemble({ ...bare, metadata: encodeMetadata({ injected: true }) })),
      "G7",
      "metadataHash"
    );
  });

  it("rejects non-conforming content even when it is consistently signed", async () => {
    // A hand-built file whose signature and ids are all correct for content
    // the gate would have refused: a name that displays a second address.
    const content = plainContent();
    content.resource.name = "Send to 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const wallet = new Wallet(TEST_PRIVATE_KEY);
    // Sign outside the library, which would refuse to.
    const { NOTA_EIP712_TYPES, notaDomain } = await import("../../../src/core/crypto/index.js");
    const signature = await wallet.signTypedData(notaDomain(REGISTRY), NOTA_EIP712_TYPES, content);
    const { TypedDataEncoder } = await import("ethers");
    const notaId = TypedDataEncoder.hash(notaDomain(REGISTRY), NOTA_EIP712_TYPES, content);
    const file = assemble({
      content,
      signature: { scheme: "eip712-secp256k1", signature, signer: ISSUER },
      receipt: { ...(await mintParts(plainContent())).receipt, notaId },
    });
    expectRule(() => readNota(file), "G6", "resource.name");
  });
});

describe("trust rule 3: the signature", () => {
  it("rejects a signature by another key", async () => {
    const parts = await mintParts(plainContent());
    const forged = await new Wallet(OTHER_KEY).signTypedData(
      (await import("../../../src/core/crypto/index.js")).notaDomain(REGISTRY),
      (await import("../../../src/core/crypto/index.js")).NOTA_EIP712_TYPES,
      parts.content
    );
    const signature = { ...parts.signature, signature: forged };
    expectRule(() => readNota(assemble({ ...parts, signature })), "G9", "SIGN.signature");
  });

  it("rejects a signer that is not issuer.account", async () => {
    const parts = await mintParts(plainContent());
    const signature = { ...parts.signature, signer: new Wallet(OTHER_KEY).address };
    expectRule(() => readNota(assemble({ ...parts, signature })), "G9", "SIGN.signer");
  });

  it("rejects a malleable high-s signature that still recovers to the issuer", async () => {
    const parts = await mintParts(plainContent());
    const sig = parts.signature.signature;
    const r = sig.slice(2, 66);
    const s = BigInt("0x" + sig.slice(66, 130));
    const v = parseInt(sig.slice(130), 16);
    const highS = (SECP256K1_N - s).toString(16).padStart(64, "0");
    const flipped = "0x" + r + highS + (v === 27 ? "1c" : "1b");
    expectRule(
      () => readNota(assemble({ ...parts, signature: { ...parts.signature, signature: flipped } })),
      "G9",
      "SIGN.signature"
    );
  });

  it.each([
    ["v of 0 or 1", (s: string) => s.slice(0, 130) + (s.endsWith("1b") ? "00" : "01")],
    ["uppercase hex", (s: string) => "0x" + s.slice(2).toUpperCase()],
    ["64 bytes", (s: string) => s.slice(0, 130)],
    ["66 bytes", (s: string) => s + "00"],
    ["no 0x prefix", (s: string) => s.slice(2)],
    ["zero r", (s: string) => "0x" + "00".repeat(32) + s.slice(66)],
  ])("rejects a signature with %s", async (_name, mutate) => {
    const parts = await mintParts(plainContent());
    const signature = { ...parts.signature, signature: mutate(parts.signature.signature) };
    expectRule(() => readNota(assemble({ ...parts, signature })), "G9", "SIGN.signature");
  });

  it("rejects unknown schemes and malformed SIGN payloads", async () => {
    const parts = await mintParts(plainContent());
    const bad: unknown[] = [
      { ...parts.signature, scheme: "eip191" },
      { ...parts.signature, scheme: "EIP712-SECP256K1" },
      { ...parts.signature, message: "extra member" },
      { scheme: parts.signature.scheme, signature: parts.signature.signature },
      { ...parts.signature, signer: ISSUER.toLowerCase() },
    ];
    for (const signature of bad) {
      expect(() => readNota(assemble({ ...parts, signature }))).toThrow(NotaConformanceError);
    }
  });

  it("accepts an erc1271 signature without claiming to have verified it", async () => {
    // A contract account signs with ERC-1271. That cannot be checked offline:
    // the file reads, and says so.
    const content = plainContent();
    const signature: NotaSignature = { scheme: "erc1271", signature: "0x" + "5a".repeat(96), signer: ISSUER };
    const receipt = buildReceipt({
      registry: REGISTRY,
      notaId: computeNotaId(content, REGISTRY),
      resourceId: computeNotaResourceId(content),
      ...EXAMPLE_MINT,
      controlProof: "claimed", // a contract on another chain proves nothing about this address
    });
    const nota = readNota(writeNota({ content, signature, receipt }));
    expect(nota.signature.scheme).toBe("erc1271");
    expect(nota.signatureVerified).toBe(false);
    expect(nota.state).toBe("unconfirmed");
  });
});

describe("what the ruleset 1 gate guarantees about a receipt", () => {
  it("derives the control proof", () => {
    const self = plainContent();
    expect(deriveControlProof(self, "eip712-secp256k1", REGISTRY)).toBe("self");
    // A contract account proves control only on the registry chain.
    expect(deriveControlProof(self, "erc1271", REGISTRY)).toBe("claimed");
    const onRegistryChain = plainContent({ chain: { name: "sepolia", chainId: REGISTRY.chainId, network: "testnet" } });
    expect(deriveControlProof(onRegistryChain, "erc1271", REGISTRY)).toBe("self");
    // Every other case is claimed.
    expect(deriveControlProof(plainContent({ type: "contract" }), "eip712-secp256k1", REGISTRY)).toBe("claimed");
    const other = plainContent();
    other.resource.identifier = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    expect(deriveControlProof(other, "eip712-secp256k1", REGISTRY)).toBe("claimed");
    const nonEvm = plainContent({ chain: { name: "bitcoin", chainId: 0, network: "mainnet" } });
    expect(deriveControlProof(nonEvm, "eip712-secp256k1", REGISTRY)).toBe("claimed");
  });

  it("rejects a receipt that overstates the control proof", async () => {
    // Someone else's address, with a receipt claiming the gate established control.
    const content = plainContent();
    content.resource.identifier = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const parts = await mintParts(content);
    expect(parts.receipt.controlProof).toBe("claimed");
    const receipt = { ...parts.receipt, controlProof: "self" };
    expectRule(() => readNota(assemble({ ...parts, receipt })), "RECEIPT", "RCPT.controlProof");
  });

  it("rejects a receipt that understates it", async () => {
    const parts = await mintParts(plainContent());
    const receipt = { ...parts.receipt, controlProof: "claimed" };
    expectRule(() => readNota(assemble({ ...parts, receipt })), "RECEIPT", "RCPT.controlProof");
  });

  it("rejects a mint outside the time window (G8)", async () => {
    const mintedAt = EXAMPLE_MINT.mintedAt;
    const at = async (issuedAt: number, expiresAt = 0) => {
      const parts = await mintParts(plainContent({ issuedAt, expiresAt }));
      return () => readNota(assemble(parts));
    };
    // Signed 24 hours before the mint: the edge of MINT_WINDOW.
    expect(await at(mintedAt - 86_400)).not.toThrow();
    expectRule(await at(mintedAt - 86_401), "G8", "issuedAt");
    // Signed up to 15 minutes after the block time: MAX_CLOCK_SKEW.
    expect(await at(mintedAt + 900)).not.toThrow();
    expectRule(await at(mintedAt + 901), "G8", "issuedAt");
    // Expiry must lie after the mint, or be 0.
    expect(await at(mintedAt, mintedAt + 1)).not.toThrow();
    expectRule(await at(mintedAt, mintedAt), "G8", "expiresAt");
    expectRule(await at(mintedAt, 1), "G8", "expiresAt");
  });

  it("does not apply ruleset 1 parameters to a ruleset it does not know", async () => {
    const parts = await mintParts(plainContent({ issuedAt: EXAMPLE_MINT.mintedAt - 200_000 }), null, { ruleset: 2 });
    expect(readNota(assemble(parts)).receipt.ruleset).toBe(2);
  });

  it("rejects malformed receipts", async () => {
    const parts = await mintParts(plainContent());
    const r = parts.receipt;
    const bad: unknown[] = [
      { ...r, extra: 1 },
      { ...r, mintedAt: undefined },
      { ...r, ruleset: 65_536 },
      { ...r, ruleset: -1 },
      { ...r, ruleset: 1.5 },
      { ...r, controlProof: "SELF" },
      { ...r, controlProof: 1 },
      { ...r, blockNumber: "7654321" },
      { ...r, logIndex: -1 },
      { ...r, transactionHash: "0x" + "AB".repeat(32) },
      { ...r, transactionHash: "0xabab" },
      { ...r, notaId: r.notaId.toUpperCase() },
      { ...r, registry: { chainId: 0, address: REGISTRY.address } },
      { ...r, registry: { chainId: REGISTRY.chainId, address: "0x1101" } },
      { ...r, registry: { ...REGISTRY, name: "x" } },
      { ...r, registry: REGISTRY.address },
    ];
    for (const receipt of bad) {
      const clean = JSON.parse(JSON.stringify(receipt)) as unknown; // drops undefined members
      expect(() => readNota(assemble({ ...parts, receipt: clean })), JSON.stringify(clean)).toThrow(NotaConformanceError);
    }
  });
});

describe("trust rule 4: pinned registries", () => {
  it("is not performed without a list", () => {
    expect(readNota(registered).registryPinned).toBe(false);
  });

  it("accepts a file whose registry is on the list", () => {
    const lists = [
      [REGISTRY],
      [{ chainId: 1, address: "0x0000000000000000000000000000000000009999" }, REGISTRY],
      [{ chainId: REGISTRY.chainId, address: REGISTRY.address.toLowerCase() }],
    ];
    for (const trustedRegistries of lists) {
      expect(readNota(registered, { trustedRegistries }).registryPinned).toBe(true);
    }
  });

  it("rejects a file whose registry is not on the list", () => {
    const lists = [
      [],
      [{ chainId: 1, address: REGISTRY.address }],
      [{ chainId: REGISTRY.chainId, address: "0x0000000000000000000000000000000000009999" }],
    ];
    for (const trustedRegistries of lists) {
      expectRule(() => readNota(registered, { trustedRegistries }), "REGISTRY", "RCPT.registry");
    }
  });
});

describe("annexes", () => {
  const laterStatus = (overrides: Partial<NotaStatusSnapshot>): NotaStatusSnapshot =>
    exampleStatus(overrides);

  it("appends without altering earlier bytes, numbering on from the highest object", () => {
    const one = appendAnnex(registered, [{ type: "STAT", snapshot: exampleStatus() }]);
    const disputed = laterStatus({ asOfBlock: 7_670_000, asOfTime: 1_795_700_000, status: "disputed" });
    const revoked = laterStatus({ asOfBlock: 7_680_000, asOfTime: 1_795_800_000, status: "revoked" });
    const two = appendAnnex(one, [
      { type: "STAT", snapshot: disputed },
      { type: "STAT", snapshot: revoked },
    ]);

    expect(Buffer.from(one.subarray(0, registered.length)).equals(Buffer.from(registered))).toBe(true);
    expect(Buffer.from(two.subarray(0, one.length)).equals(Buffer.from(one))).toBe(true);

    const container = readContainer(two);
    expect(container.revisions.map((r) => r.revision)).toEqual([0, 1, 2]);
    expect(container.revisions[1].objects.map((o) => [o.type, o.number])).toEqual([["STAT", 6]]);
    expect(container.revisions[1].xrefNumber).toBe(7);
    expect(container.revisions[2].objects.map((o) => [o.type, o.number])).toEqual([
      ["STAT", 8],
      ["STAT", 9],
    ]);
    expect(container.revisions[2].xrefNumber).toBe(10);
    expect(container.revisions[2].prevTrailer).toBe(container.revisions[1].trailerOffset);
    // The minted body keeps its digest.
    expect(container.revisions[0].digest).toBe(readContainer(registered).revisions[0].digest);

    const nota = readNota(two);
    expect(nota.annexObjects).toEqual([
      { type: "STAT", number: 6, revision: 1, snapshot: exampleStatus() },
      { type: "STAT", number: 8, revision: 2, snapshot: disputed },
      { type: "STAT", number: 9, revision: 2, snapshot: revoked },
    ]);
    expect(nota.statusSnapshot).toEqual(revoked);
    expect(nota).not.toHaveProperty("socialSnapshot");
  });

  it("treats the snapshot with the highest asOfBlock as current, wherever it sits", () => {
    const newer = laterStatus({ asOfBlock: 7_700_000, asOfTime: 1_796_000_000, status: "revoked" });
    const older = laterStatus({ asOfBlock: 7_660_000 });
    const file = appendAnnex(appendAnnex(registered, [{ type: "STAT", snapshot: newer }]), [
      { type: "STAT", snapshot: older },
    ]);
    expect(readNota(file).statusSnapshot?.status).toBe("revoked");
  });

  it("never upgrades the state: a verified snapshot is still unconfirmed", () => {
    const file = appendAnnex(registered, [{ type: "STAT", snapshot: exampleStatus() }]);
    expect(readNota(file).state).toBe("unconfirmed");
  });

  it("rejects a snapshot that predates the mint", () => {
    expectRule(
      () => appendAnnex(registered, [{ type: "STAT", snapshot: laterStatus({ asOfBlock: EXAMPLE_MINT.blockNumber - 1 }) }]),
      "ANNEX",
      "STAT.asOfBlock"
    );
    expectRule(
      () => appendAnnex(registered, [{ type: "STAT", snapshot: laterStatus({ asOfTime: EXAMPLE_MINT.mintedAt - 1 }) }]),
      "ANNEX",
      "STAT.asOfTime"
    );
  });

  it("rejects an empty annex and anything but STAT", () => {
    expectRule(() => appendAnnex(registered, []), "ANNEX");
    expectRule(
      () => appendAnnex(registered, [{ type: "CONT", snapshot: exampleContent() } as never]),
      "ANNEX"
    );
    // SOCL is not a v1.1 object type; the writer will not produce one.
    expectRule(
      () => appendAnnex(registered, [{ type: "SOCL", snapshot: exampleStatus() } as never]),
      "ANNEX",
      "type"
    );
    expectRule(
      () => appendAnnex(registered, [{ type: "STAT", snapshot: { ...exampleStatus(), status: "approved" } as never }]),
      "ANNEX"
    );
  });

  it("refuses to extend a file the reader would reject", () => {
    const corrupted = registered.slice();
    corrupted[200] ^= 0xff;
    expect(() => appendAnnex(corrupted, [{ type: "STAT", snapshot: exampleStatus() }])).toThrow(NotaContainerError);
    const trailing = new Uint8Array(registered.length + 1);
    trailing.set(registered);
    expect(() => appendAnnex(trailing, [{ type: "STAT", snapshot: exampleStatus() }])).toThrow(NotaContainerError);
  });

  it("enforces the 65,536-byte file limit", () => {
    // One annex holding 250 snapshots: about 62 KB.
    const run = (count: number, from: number) =>
      Array.from({ length: count }, (_, i) => ({
        type: "STAT" as const,
        snapshot: laterStatus({ asOfBlock: from + i }),
      }));
    const large = appendAnnex(registered, run(250, 7_660_000));
    expect(large.length).toBeGreaterThan(60_000);
    expect(large.length).toBeLessThanOrEqual(65_536);
    expect(readNota(large).annexObjects).toHaveLength(250);

    let error: unknown;
    try {
      appendAnnex(large, run(20, 7_670_000));
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(NotaContainerError);
    expect((error as NotaContainerError).code).toBe("SIZE_LIMIT");

    // Collapsing keeps only the current snapshot, which makes room again.
    const collapsed = collapseAnnexes(large);
    expect(readNota(collapsed).annexObjects).toHaveLength(1);
    expect(readNota(collapsed).statusSnapshot?.asOfBlock).toBe(7_660_249);
    expect(() => appendAnnex(collapsed, run(20, 7_670_000))).not.toThrow();
  });

  it("collapses a run of stale snapshots to revision 0 plus one annex", () => {
    let file = registered;
    for (let i = 0; i < 6; i++) {
      file = appendAnnex(file, [{ type: "STAT", snapshot: laterStatus({ asOfBlock: 7_660_000 + i }) }]);
    }
    expect(readNota(file).annexObjects).toHaveLength(6);
    expect(readContainer(file).revisions).toHaveLength(7);

    const collapsed = collapseAnnexes(file);
    const nota = readNota(collapsed);
    expect(nota.container.revisions).toHaveLength(2);
    expect(nota.annexObjects).toHaveLength(1);
    expect(nota.statusSnapshot?.asOfBlock).toBe(7_660_005);
    expect(Buffer.from(extractMintedBody(collapsed)).equals(Buffer.from(registered))).toBe(true);
  });

  it("collapses to fresh snapshots when given them, and to the minted body when there are none", () => {
    const stale = appendAnnex(registered, [{ type: "STAT", snapshot: exampleStatus() }]);
    const fresh = laterStatus({ asOfBlock: 7_800_000, asOfTime: 1_797_000_000, status: "superseded" });
    const collapsed = collapseAnnexes(stale, [{ type: "STAT", snapshot: fresh }]);
    expect(readNota(collapsed).annexObjects).toEqual([{ type: "STAT", number: 6, revision: 1, snapshot: fresh }]);
    expect(Buffer.from(collapseAnnexes(stale, [])).equals(Buffer.from(registered))).toBe(true);
    expect(Buffer.from(collapseAnnexes(registered)).equals(Buffer.from(registered))).toBe(true);
  });
});

describe("reconstructFromMintEvent", () => {
  const location = {
    registry: REGISTRY,
    transactionHash: EXAMPLE_MINT.transactionHash,
    blockNumber: EXAMPLE_MINT.blockNumber,
    logIndex: EXAMPLE_MINT.logIndex,
    blockTimestamp: EXAMPLE_MINT.mintedAt,
    issuerHasCode: false,
  };

  async function exampleEvent() {
    const content = exampleContent();
    const { signature } = await signNotaContent(content, REGISTRY, TEST_PRIVATE_KEY);
    return {
      notaId: computeNotaId(content, REGISTRY),
      resourceId: computeNotaResourceId(content),
      issuer: ISSUER,
      ruleset: 1n,
      controlProof: 1n,
      nota: {
        version: content.version,
        type_: content.type,
        chain: { ...content.chain, chainId: BigInt(content.chain.chainId) },
        resource: {
          identifier: content.resource.identifier,
          name: content.resource.name,
          alias_: content.resource.alias,
          description: content.resource.description,
        },
        issuer: content.issuer,
        metadataHash: content.metadataHash,
        supersedes: content.supersedes,
        issuedAt: BigInt(content.issuedAt),
        expiresAt: BigInt(content.expiresAt),
      },
      metadata: "0x" + Buffer.from(encodeMetadata(EXAMPLE_METADATA)).toString("hex"),
      signature,
    };
  }

  it("rebuilds the example from plain decoded fields, byte for byte", async () => {
    const file = reconstructFromMintEvent(await exampleEvent(), location);
    expect(Buffer.from(file).equals(Buffer.from(registered))).toBe(true);
  });

  it("accepts the JSON member names as well as the Solidity ones", async () => {
    const event = await exampleEvent();
    const { type_, ...nota } = event.nota;
    const { alias_, ...resource } = nota.resource;
    const renamed = { ...event, nota: { ...nota, type: type_, resource: { ...resource, alias: alias_ } } };
    expect(contentFromMintedStruct(renamed.nota)).toEqual(exampleContent());
    expect(Buffer.from(reconstructFromMintEvent(renamed, location)).equals(Buffer.from(registered))).toBe(true);
  });

  it("normalizes hex case, which the chain does not carry", async () => {
    const event = await exampleEvent();
    const shouting = {
      ...event,
      notaId: "0x" + event.notaId.slice(2).toUpperCase(),
      signature: "0x" + event.signature.slice(2).toUpperCase(),
      nota: { ...event.nota, metadataHash: "0x" + event.nota.metadataHash.slice(2).toUpperCase() },
    };
    const file = reconstructFromMintEvent(shouting, { ...location, transactionHash: "0x" + "AB".repeat(32) });
    expect(Buffer.from(file).equals(Buffer.from(registered))).toBe(true);
  });

  it("writes no META object when the event carries no metadata", async () => {
    const parts = await mintParts(plainContent());
    const event = {
      ...(await exampleEvent()),
      notaId: parts.receipt.notaId,
      nota: { ...(await exampleEvent()).nota, metadataHash: ZERO32 },
      metadata: "0x",
      signature: parts.signature.signature,
    };
    const file = reconstructFromMintEvent(event, location);
    expect(Buffer.from(file).equals(Buffer.from(writeNota(parts)))).toBe(true);
    expect(readNota(file).metadata).toBeNull();
  });

  it("uses the erc1271 scheme when the issuer has code", async () => {
    const event = { ...(await exampleEvent()), controlProof: 0, signature: "0x" + "5a".repeat(70) };
    const file = reconstructFromMintEvent(event, { ...location, issuerHasCode: true });
    const nota = readNota(file);
    expect(nota.signature).toEqual({ scheme: "erc1271", signature: "0x" + "5a".repeat(70), signer: ISSUER });
    expect(nota.receipt.controlProof).toBe("claimed");
    expect(nota.signatureVerified).toBe(false);
  });

  it("rejects an event that does not describe its own content", async () => {
    const event = await exampleEvent();
    // A log from a different registry: the notaId topic is not this content's id here.
    expectRule(
      () => reconstructFromMintEvent(event, { ...location, registry: { chainId: 1, address: REGISTRY.address } }),
      "RECEIPT",
      "RCPT.notaId"
    );
    expectRule(() => reconstructFromMintEvent({ ...event, resourceId: ZERO32 }, location), "RECEIPT", "RCPT.resourceId");
    expectRule(
      () => reconstructFromMintEvent({ ...event, issuer: new Wallet(OTHER_KEY).address }, location),
      "RECEIPT",
      "issuer"
    );
    expectRule(() => reconstructFromMintEvent({ ...event, metadata: "0x" }, location), "G7");
    expectRule(() => reconstructFromMintEvent({ ...event, controlProof: 0 }, location), "RECEIPT", "RCPT.controlProof");
    expectRule(() => reconstructFromMintEvent({ ...event, controlProof: 2 }, location), "RECEIPT");
    expectRule(() => reconstructFromMintEvent(event, { ...location, issuerHasCode: true }), "RECEIPT");
  });

  it("reports a mint whose integers cannot be carried in canonical JSON", async () => {
    // The gate accepts any uint64 expiresAt after the block time, but JSON
    // numbers are doubles. Such a mint has no .nota file.
    const event = await exampleEvent();
    const huge = { ...event, nota: { ...event.nota, expiresAt: 2n ** 64n - 1n } };
    expectRule(() => reconstructFromMintEvent(huge, location), "SCHEMA", "expiresAt");
    const bigChain = { ...event, nota: { ...event.nota, chain: { ...event.nota.chain, chainId: 2n ** 53n } } };
    expectRule(() => reconstructFromMintEvent(bigChain, location), "SCHEMA", "chain.chainId");
  });
});
