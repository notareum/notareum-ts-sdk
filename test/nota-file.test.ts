/**
 * NotaFileClient: the mint flow end to end, and the reader's display states.
 */

import { TypedDataEncoder, Wallet } from "ethers";
import { beforeEach, describe, expect, it } from "vitest";
import { Notareum } from "../src/client.js";
import type { NotareumInstance } from "../src/client.js";
import { NotaFileClient } from "../src/clients/nota-file.js";
import {
  NOTA_ZERO_HASH,
  NotaConformanceError,
  NotaContainerError,
  NotaParseError,
  NotaSignatureError,
  NotaStatus,
  VerificationLevel,
  buildReceipt,
  computeNotaId,
  computeNotaResourceId,
  writeNota,
} from "../src/core/index.js";
import {
  ConfigurationError,
  ConformanceFailedError,
  SignerRequiredError,
  UntrustedRegistryError,
} from "../src/errors.js";
import { mintArguments } from "../src/mint.js";
import { ADDRESSES, ISSUER, ISSUER_KEY, OTHER, OTHER_KEY, REGISTRY, deployProtocol } from "./helpers/protocol.js";
import type { Protocol } from "./helpers/protocol.js";

const CONTRACT = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

let protocol: Protocol;
let ntm: NotareumInstance;
let readOnly: NotareumInstance;

const ADDRESS_FILE = {
  type: "address",
  chainName: "ethereum",
  chainId: 1,
  identifier: ISSUER,
  name: "Treasury",
} as const;

beforeEach(() => {
  protocol = deployProtocol();
  ntm = Notareum({ provider: protocol.node, signer: protocol.wallet(), contracts: ADDRESSES });
  readOnly = Notareum({ provider: protocol.node, contracts: ADDRESSES });
});

describe("compose", () => {
  it("fills the issuer from the signer and issuedAt from the chain's clock", async () => {
    const draft = await ntm.nota.compose(ADDRESS_FILE);
    expect(draft.content).toEqual({
      version: "1.1",
      type: "address",
      chain: { name: "ethereum", chainId: 1, network: "mainnet" },
      resource: { identifier: ISSUER, name: "Treasury", alias: "", description: "" },
      issuer: { account: ISSUER, name: "", entityType: "" },
      metadataHash: NOTA_ZERO_HASH,
      supersedes: NOTA_ZERO_HASH,
      issuedAt: protocol.node.timestamp + protocol.node.blockTime,
      expiresAt: 0,
    });
    expect(draft.metadata).toBeNull();
  });

  it("accepts core's nested input as well", async () => {
    const draft = await readOnly.nota.compose({
      type: "contract",
      chain: { name: "ethereum", chainId: 11155111, network: "testnet" },
      resource: { identifier: CONTRACT },
      issuer: { account: OTHER.toLowerCase() },
      metadata: { abi: "erc20" },
      issuedAt: 1_800_000_123,
    });
    expect(draft.content.issuer.account).toBe(OTHER);
    expect(draft.content.issuedAt).toBe(1_800_000_123);
    expect(new TextDecoder().decode(draft.metadata!)).toBe('{"abi":"erc20"}');
  });

  it("names the issuer's current file as the one being superseded", async () => {
    const first = await ntm.nota.create(ADDRESS_FILE);
    const draft = await ntm.nota.compose({ ...ADDRESS_FILE, name: "Treasury (new)" });
    expect(draft.content.supersedes).toBe(first.notaId);
    // An explicit value is left alone.
    const explicit = await ntm.nota.compose({ ...ADDRESS_FILE, supersedes: NOTA_ZERO_HASH });
    expect(explicit.content.supersedes).toBe(NOTA_ZERO_HASH);
  });

  it("reports the rule and member that do not conform", async () => {
    const bad = await ntm.nota.compose({ ...ADDRESS_FILE, name: "Pay 0xdeadbeefdeadbeef" }).catch((e) => e);
    expect(bad).toBeInstanceOf(NotaConformanceError);
    expect(bad).toMatchObject({ rule: "G6", field: "resource.name" });

    const lower = await ntm.nota.compose({ ...ADDRESS_FILE, identifier: ISSUER.toLowerCase() }).catch((e) => e);
    expect(lower).toMatchObject({ rule: "G4", field: "resource.identifier" });

    const unknown = await ntm.nota.compose({ ...ADDRESS_FILE, type: "domain" }).catch((e) => e);
    expect(unknown).toMatchObject({ rule: "G1", field: "type" });
  });

  it("needs an issuer when there is no signer", async () => {
    await expect(readOnly.nota.compose(ADDRESS_FILE)).rejects.toBeInstanceOf(ConfigurationError);
    const draft = await readOnly.nota.compose({ ...ADDRESS_FILE, issuer: ISSUER });
    expect(draft.content.issuer.account).toBe(ISSUER);
  });

  it("works offline, with the local clock", async () => {
    const offline = new NotaFileClient();
    const before = Math.floor(Date.now() / 1000);
    const draft = await offline.compose({ ...ADDRESS_FILE, issuer: ISSUER });
    expect(draft.content.issuedAt).toBeGreaterThanOrEqual(before);
    await expect(offline.typedData(draft)).rejects.toBeInstanceOf(ConfigurationError);
  });
});

describe("signing", () => {
  it("builds the EIP-712 request whose digest is the notaId", async () => {
    const draft = await ntm.nota.compose(ADDRESS_FILE);
    const typed = await ntm.nota.typedData(draft);
    expect(typed.domain).toEqual({
      name: "Notareum",
      version: "1.1",
      chainId: REGISTRY.chainId,
      verifyingContract: REGISTRY.address,
    });
    expect(typed.primaryType).toBe("Nota");
    expect(typed.message).toBe(draft.content);
    expect(TypedDataEncoder.hash(typed.domain, typed.types, typed.message)).toBe(
      computeNotaId(draft.content, REGISTRY)
    );
  });

  it("signs with the configured signer, who must be the issuer", async () => {
    const draft = await ntm.nota.compose(ADDRESS_FILE);
    const signature = await ntm.nota.sign(draft);
    expect(signature).toMatchObject({ scheme: "eip712-secp256k1", signer: ISSUER });
    await expect(ntm.nota.sign(draft, new Wallet(OTHER_KEY))).rejects.toBeInstanceOf(NotaSignatureError);
    await expect(readOnly.nota.sign(draft)).rejects.toBeInstanceOf(SignerRequiredError);
  });

  it("accepts what a wallet returns from eth_signTypedData_v4", async () => {
    const draft = await ntm.nota.compose(ADDRESS_FILE);
    const typed = await ntm.nota.typedData(draft);
    const raw = await new Wallet(ISSUER_KEY).signTypedData(typed.domain, typed.types, typed.message);
    const signature = await readOnly.nota.signatureFromWallet(raw, draft);
    expect(signature).toEqual(await ntm.nota.sign(draft));

    const foreign = await new Wallet(OTHER_KEY).signTypedData(typed.domain, typed.types, typed.message);
    await expect(readOnly.nota.signatureFromWallet(foreign, draft)).rejects.toBeInstanceOf(NotaSignatureError);
  });

  it("keeps a contract account's signature as ERC-1271 bytes", async () => {
    protocol.node.setCode(ISSUER);
    const draft = await ntm.nota.compose(ADDRESS_FILE);
    const signature = await readOnly.nota.signatureFromWallet("0xAABBCC", draft);
    expect(signature).toEqual({ scheme: "erc1271", signature: "0xaabbcc", signer: ISSUER });
  });
});

describe("create", () => {
  it("runs the whole flow and returns a registered file", async () => {
    const minted = await ntm.nota.create({ ...ADDRESS_FILE, metadata: { tags: ["treasury"] } });

    const steps = protocol.node.calls.map((c) => `${c.name}${c.mutating ? "!" : ""}`);
    // Preflight before signing, signed preflight and simulation before sending.
    expect(steps.filter((s) => s === "check")).toHaveLength(2);
    expect(steps.indexOf("check")).toBeLessThan(steps.indexOf("mint"));
    expect(steps.filter((s) => s === "mint!")).toHaveLength(1);

    const { file, standing } = await readOnly.nota.verify(minted.file);
    expect(file.notaId).toBe(minted.notaId);
    expect(file.metadata).toEqual({ tags: ["treasury"] });
    expect(standing).toMatchObject({
      state: "registered",
      label: "Registered. Not socially verified.",
      confirmed: true,
      status: NotaStatus.REGISTERED,
      controlProof: "self",
      canonical: false,
      expired: false,
    });
  });

  it("stops at the preflight, before anything is signed or sent", async () => {
    await ntm.nota.create(ADDRESS_FILE);
    protocol.node.calls.length = 0;
    // Same resource, no supersedes: the gate's succession rule refuses it.
    const failure = await ntm.nota
      .create({ ...ADDRESS_FILE, name: "Again", supersedes: NOTA_ZERO_HASH })
      .catch((e) => e);
    expect(failure).toBeInstanceOf(ConformanceFailedError);
    expect(failure).toMatchObject({ rule: 11, ruleId: "G11" });
    expect(protocol.node.callsTo("mint")).toHaveLength(0);
  });

  it("needs a signer", async () => {
    await expect(readOnly.nota.create({ ...ADDRESS_FILE, issuer: ISSUER })).rejects.toBeInstanceOf(
      SignerRequiredError
    );
  });

  it("writes the file of a mint a wallet library sent", async () => {
    const draft = await ntm.nota.compose({ ...ADDRESS_FILE, alias: "treasury.nota" });
    protocol.approve(ISSUER, ADDRESSES.notaRegistry, 100n * 10n ** 18n);
    const signature = await ntm.nota.sign(draft);
    // What a dApp does with wagmi: send mint() itself, then hand over the hash.
    const { NotareumNotaRegistryABI } = await import("../src/abi/index.js");
    const { Contract } = await import("ethers");
    const registry = new Contract(ADDRESSES.notaRegistry, NotareumNotaRegistryABI, protocol.wallet());
    const tx = await registry.mint(...mintArguments(draft, signature));
    const minted = await readOnly.nota.fromTransaction(tx.hash, { confirmations: 1 });
    expect(minted.fileName).toBe("treasury.nota");
    expect((await readOnly.nota.verify(minted.file)).standing.state).toBe("registered");
  });
});

describe("verify (reader display states)", () => {
  async function mintOne(overrides: Record<string, unknown> = {}) {
    return ntm.nota.create({ ...ADDRESS_FILE, ...overrides });
  }

  it("shows a socially verified file with its level, and that it is canonical", async () => {
    const minted = await mintOne();
    const record = protocol.records.get(minted.notaId)!;
    record.status = NotaStatus.VERIFIED;
    record.level = VerificationLevel.ENHANCED;
    protocol.resources.get(minted.resourceId)!.canonical = minted.notaId;

    const { standing } = await readOnly.nota.verify(minted.file);
    expect(standing).toMatchObject({
      state: "socially-verified",
      label: "Socially verified (enhanced)",
      level: "enhanced",
      canonical: true,
    });
  });

  it("notes an open request without calling the file verified", async () => {
    const minted = await mintOne();
    protocol.records.get(minted.notaId)!.status = NotaStatus.PENDING;
    const { standing } = await readOnly.nota.verify(minted.file);
    expect(standing.state).toBe("registered");
    expect(standing.notes.join(" ")).toMatch(/request is open/);
  });

  it("says that a claimed resource is only claimed", async () => {
    const minted = await mintOne({ type: "contract", identifier: CONTRACT });
    const { standing } = await readOnly.nota.verify(minted.file);
    expect(standing.controlProof).toBe("claimed");
    expect(standing.notes.join(" ")).toMatch(/Nothing on-chain establishes/);
  });

  it.each([
    [NotaStatus.DISPUTED, "Warning: disputed"],
    [NotaStatus.REVOKED, "Warning: revoked"],
    [NotaStatus.SUPERSEDED, "Warning: superseded"],
  ])("warns on status %i", async (status, label) => {
    const minted = await mintOne();
    protocol.records.get(minted.notaId)!.status = status;
    const { standing } = await readOnly.nota.verify(minted.file);
    expect(standing).toMatchObject({ state: "warning", label, confirmed: true });
  });

  it("warns once a file has expired, by the chain's clock", async () => {
    const minted = await mintOne({ expiresAt: protocol.node.timestamp + 3_600 });
    expect((await readOnly.nota.verify(minted.file)).standing.state).toBe("registered");
    protocol.node.mine(400);
    const { standing } = await readOnly.nota.verify(minted.file);
    expect(standing).toMatchObject({ state: "warning", label: "Warning: expired", expired: true });
  });

  it("tells the reader of a verified file that a newer version is waiting", async () => {
    const minted = await mintOne();
    const record = protocol.records.get(minted.notaId)!;
    record.status = NotaStatus.VERIFIED;
    record.supersededBy = "0x" + "77".repeat(32);
    const { standing } = await readOnly.nota.verify(minted.file);
    expect(standing.state).toBe("socially-verified");
    expect(standing.supersededBy).toBe("0x" + "77".repeat(32));
    expect(standing.notes.join(" ")).toMatch(/newer version/);
  });

  it("refuses a file whose receipt the registry does not know", async () => {
    // A well-formed, correctly signed file with a fabricated receipt.
    const draft = await ntm.nota.compose({ ...ADDRESS_FILE, name: "Never minted" });
    const forged = writeNota({
      content: draft.content,
      signature: await ntm.nota.sign(draft),
      receipt: buildReceipt({
        registry: REGISTRY,
        notaId: computeNotaId(draft.content, REGISTRY),
        resourceId: computeNotaResourceId(draft.content),
        ruleset: 1,
        controlProof: "self",
        transactionHash: "0x" + "11".repeat(32),
        blockNumber: 90,
        logIndex: 0,
        mintedAt: draft.content.issuedAt,
      }),
    });
    // Offline it is indistinguishable from the real thing...
    expect(readOnly.nota.read(forged).state).toBe("unconfirmed");
    // ...and the registry settles it.
    const { standing } = await readOnly.nota.verify(forged);
    expect(standing).toMatchObject({ state: "invalid", confirmed: false });
    expect(standing.notes[0]).toMatch(/no record/);
  });

  it("stays unconfirmed when the registry cannot be reached", async () => {
    const minted = await mintOne();
    await readOnly.registry.deployment();
    protocol.node.offline = "connection refused";
    const { standing } = await readOnly.nota.verify(minted.file);
    protocol.node.offline = null;
    expect(standing).toMatchObject({ state: "unconfirmed", label: "Not confirmed", confirmed: false });
    expect(standing.notes.join(" ")).toMatch(/could not be reached/);
  });

  it("refuses a file minted on a registry it does not trust", async () => {
    const minted = await mintOne();
    const elsewhere = Notareum({
      provider: protocol.node,
      contracts: { ...ADDRESSES, notaRegistry: ADDRESSES.feeManager },
    });
    const refused = await elsewhere.nota.verify(minted.file).catch((e) => e);
    expect(refused).toBeInstanceOf(UntrustedRegistryError);
    expect(refused.registry).toEqual(REGISTRY);

    // Unless that registry is on the reader's pinned list; then it is read, but not confirmed here.
    const trusting = Notareum({
      provider: protocol.node,
      contracts: { ...ADDRESSES, notaRegistry: ADDRESSES.feeManager },
      trustedRegistries: [REGISTRY],
    });
    const { standing } = await trusting.nota.verify(minted.file);
    expect(standing.state).toBe("unconfirmed");
    expect(standing.notes.join(" ")).toMatch(/another trusted registry/);
  });

  it("refuses a corrupted file outright", async () => {
    const minted = await mintOne();
    const corrupted = minted.file.slice();
    corrupted[40] ^= 0x01;
    await expect(readOnly.nota.verify(corrupted)).rejects.toBeInstanceOf(NotaContainerError);
    await expect(readOnly.nota.verify(minted.file.slice(0, -1))).rejects.toBeInstanceOf(NotaContainerError);
  });
});

describe("legacy v1.0 documents", () => {
  const LEGACY = JSON.stringify({
    version: "1.0",
    type: "ipfs",
    chain: { name: "ethereum", chainId: 1, network: "mainnet" },
    resource: {
      identifier: "ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
      name: "Whitepaper",
      metadata: { mime: "application/pdf" },
    },
    issuer: { address: ISSUER.toLowerCase(), name: "Example Labs", verified: true },
    verification: { status: "verified", level: "institutional" },
    signature: {
      algorithm: "ECDSA",
      curve: "secp256k1",
      address: ISSUER,
      message: "Notareum v1.0 | ...",
      signature: "0x" + "00".repeat(65),
      timestamp: 1_700_000_000,
    },
  });

  it("is told apart from a v1.1 container by its first byte", async () => {
    const minted = await ntm.nota.create(ADDRESS_FILE);
    expect(ntm.nota.isLegacy(LEGACY)).toBe(true);
    expect(ntm.nota.isLegacy(new TextEncoder().encode(LEGACY))).toBe(true);
    expect(ntm.nota.isLegacy(minted.file)).toBe(false);
    // The strict reader names the reason rather than guessing.
    expect(() => ntm.nota.read(new TextEncoder().encode(LEGACY))).toThrow(/LEGACY_DOCUMENT/);
  });

  it("imports as a draft that carries no claim to being verified", async () => {
    const imported = ntm.nota.importLegacy(LEGACY, { issuedAt: protocol.node.timestamp });
    expect(imported.issues).toEqual([]);
    expect(imported.draft.content).toMatchObject({
      version: "1.1",
      type: "ipfs",
      resource: { identifier: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", name: "Whitepaper" },
      issuer: { account: ISSUER, name: "Example Labs" },
    });
    expect(imported.draft.content).not.toHaveProperty("verification");
    expect(imported.notes.join("\n")).toMatch(/ipfs:\/\/ prefix/);
    expect(imported.notes.join("\n")).toMatch(/verification: dropped/);

    // The draft mints like any other, and is then merely registered.
    const minted = await ntm.nota.mint(imported.draft);
    const { standing } = await readOnly.nota.verify(minted.file);
    expect(standing.state).toBe("registered");
  });

  it("lists what stops a v1.0 document from being minted", () => {
    const doc = JSON.parse(LEGACY);
    doc.resource.name = "See https://example.com";
    const imported = ntm.nota.importLegacy(JSON.stringify(doc));
    expect(imported.issues).toContainEqual(expect.objectContaining({ rule: "G6", field: "resource.name" }));
  });

  it("rejects what is not a v1.0 document", () => {
    expect(() => ntm.nota.importLegacy("not json")).toThrow(NotaParseError);
  });
});
