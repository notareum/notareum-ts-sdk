/**
 * RegistryClient against the real ABI (see helpers/fake-node.ts).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { RegistryClient } from "../src/clients/registry.js";
import {
  NOTA_ZERO_HASH,
  NotaStatus,
  VerificationLevel,
  composeNotaDraft,
  computeNotaId,
  readNota,
  signNotaContent,
} from "../src/core/index.js";
import type { NotaDraft, NotaDraftInput } from "../src/core/index.js";
import {
  ConformanceFailedError,
  ContractCallError,
  NotaNotFoundError,
  SignerRequiredError,
} from "../src/errors.js";
import { FakeNode } from "./helpers/fake-node.js";
import { ADDRESSES, ISSUER, ISSUER_KEY, OTHER, OTHER_KEY, REGISTRY, deployProtocol } from "./helpers/protocol.js";
import type { Protocol } from "./helpers/protocol.js";

const CONTRACT = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

let protocol: Protocol;
let reader: RegistryClient;
let client: RegistryClient;

function draftFor(overrides: Partial<NotaDraftInput> = {}, now = protocol.node.timestamp): NotaDraft {
  return composeNotaDraft({
    type: "address",
    chain: { name: "ethereum", chainId: 1 },
    resource: { identifier: ISSUER, name: "Treasury" },
    issuer: { account: ISSUER, name: "Example Labs", entityType: "organization" },
    issuedAt: now,
    ...overrides,
  });
}

const sign = (draft: NotaDraft, key = ISSUER_KEY) => signNotaContent(draft.content, REGISTRY, key);

beforeEach(() => {
  protocol = deployProtocol();
  reader = new RegistryClient(ADDRESSES.notaRegistry, protocol.node, undefined, { pollingInterval: 5 });
  client = new RegistryClient(ADDRESSES.notaRegistry, protocol.node, protocol.wallet());
});

describe("deployment", () => {
  it("names the chain and the registry", async () => {
    expect(await reader.deployment()).toEqual(REGISTRY);
  });

  it("reads the gate from the registry unless one is configured", async () => {
    expect(await reader.conformanceGate()).toBe(ADDRESSES.conformanceGate);
    const pinned = new RegistryClient(ADDRESSES.notaRegistry, protocol.node, undefined, { conformanceGate: OTHER });
    expect(await pinned.conformanceGate()).toBe(OTHER);
    expect(await reader.ruleset()).toBe(1);
  });

  it("takes the chain's clock from the pending block", async () => {
    expect(await reader.chainTime()).toBe(protocol.node.timestamp + protocol.node.blockTime);
  });

  it("tells contract accounts from externally owned ones", async () => {
    expect(await reader.isContractAccount(ISSUER)).toBe(false);
    expect(await reader.isContractAccount(ADDRESSES.notaToken)).toBe(false);
    protocol.node.setCode(OTHER);
    expect(await reader.isContractAccount(OTHER)).toBe(true);
  });
});

describe("check (preflight)", () => {
  it("reports an unsigned draft that passes every other rule as ready to sign", async () => {
    const draft = draftFor();
    const result = await reader.check(draft);
    expect(result).toMatchObject({ ok: false, readyToSign: true, rule: 9, ruleId: "G9", controlProof: null });
    expect(result.notaId).toBe(computeNotaId(draft.content, REGISTRY));
    // The struct crossed the real ABI: the node decoded it as (version, type_, chain, resource, ...).
    const [struct, metadata, signature] = protocol.node.callsTo("check")[0].args as [unknown[], string, string];
    expect(struct.slice(0, 2)).toEqual(["1.1", "address"]);
    expect(struct[3]).toEqual([ISSUER, "Treasury", "", ""]);
    expect([metadata, signature]).toEqual(["0x", "0x"]);
  });

  it("passes a signed draft and reports the control proof", async () => {
    const draft = draftFor();
    const result = await reader.check(draft, await sign(draft));
    expect(result).toMatchObject({ ok: true, readyToSign: true, rule: null, controlProof: "self" });

    const claimed = draftFor({ type: "contract", resource: { identifier: CONTRACT } });
    expect((await reader.check(claimed, await sign(claimed))).controlProof).toBe("claimed");
  });

  it("names the rule that failed", async () => {
    const stale = draftFor({}, protocol.node.timestamp - 3 * 86_400);
    const result = await reader.check(stale);
    expect(result).toMatchObject({ ok: false, readyToSign: false, rule: 8, ruleId: "G8" });
    expect(result.message).toMatch(/issuedAt/);
  });

  it("rejects a signature from anyone but the issuer", async () => {
    const draft = draftFor();
    const forged = await signNotaContent(
      { ...draft.content, issuer: { ...draft.content.issuer, account: OTHER } },
      REGISTRY,
      OTHER_KEY
    );
    expect(await reader.check(draft, forged.signature)).toMatchObject({ ok: false, rule: 9 });
  });
});

describe("mint", () => {
  it("mints and returns a file the strict reader accepts", async () => {
    const draft = draftFor({ metadata: { tags: ["treasury"] } });
    const minted = await client.mint(draft, await sign(draft));

    expect(minted.notaId).toBe(computeNotaId(draft.content, REGISTRY));
    expect(minted.fileName).toBe(`${minted.notaId.slice(0, 18)}.nota`);
    const nota = readNota(minted.file, { trustedRegistries: [REGISTRY] });
    expect(nota.content).toEqual(draft.content);
    expect(nota.metadata).toEqual({ tags: ["treasury"] });
    expect(nota.signatureVerified).toBe(true);
    expect(nota.receipt).toMatchObject({
      registry: REGISTRY,
      ruleset: 1,
      controlProof: "self",
      transactionHash: minted.transactionHash,
      blockNumber: minted.blockNumber,
      logIndex: 2,
      mintedAt: protocol.node.timestamp,
    });
    expect(protocol.records.get(minted.notaId)?.status).toBe(NotaStatus.REGISTERED);
  });

  it("names the file after its alias and collects the alias fee", async () => {
    const draft = draftFor({ resource: { identifier: ISSUER, alias: "treasury.nota" } });
    expect(await reader.quoteMintFees(draft)).toEqual({
      mintFee: 0n,
      aliasFee: 100n * 10n ** 18n,
      total: 100n * 10n ** 18n,
    });

    // Without an allowance the token's error surfaces, decoded, before anything is sent.
    const failure = await client.mint(draft, await sign(draft)).catch((e) => e);
    expect(failure).toBeInstanceOf(ContractCallError);
    expect(failure.revertName).toBe("ERC20InsufficientAllowance");
    expect(protocol.records.size).toBe(0);

    protocol.approve(ISSUER, ADDRESSES.notaRegistry, 100n * 10n ** 18n);
    const minted = await client.mint(draft, await sign(draft));
    expect(minted.fileName).toBe("treasury.nota");
    expect(await reader.resolveAlias("treasury.nota")).toBe(minted.notaId);
    expect(await reader.aliasInfo("treasury.nota")).toEqual({
      alias: "treasury.nota",
      resourceId: minted.resourceId,
      owner: ISSUER,
      notaId: minted.notaId,
    });

    // A successor keeps its alias at no charge.
    const successor = draftFor({
      resource: { identifier: ISSUER, alias: "treasury.nota", name: "Renamed" },
      supersedes: minted.notaId,
    });
    expect((await reader.quoteMintFees(successor)).total).toBe(0n);
  });

  it("lets a relayer submit what the issuer signed", async () => {
    const relayer = new RegistryClient(ADDRESSES.notaRegistry, protocol.node, protocol.wallet(OTHER_KEY));
    const draft = draftFor();
    const minted = await relayer.mint(draft, await sign(draft));
    expect(protocol.node.callsTo("mint").at(-1)).toMatchObject({ from: OTHER, mutating: true });
    expect(protocol.records.get(minted.notaId)?.issuer).toBe(ISSUER);
  });

  it("refuses non-conforming content before sending anything", async () => {
    const draft = draftFor();
    const signature = await sign(draft);
    await client.mint(draft, signature);
    const again = await client.mint(draft, signature).catch((e) => e);
    expect(again).toBeInstanceOf(ConformanceFailedError);
    expect(again).toMatchObject({ rule: 10, ruleId: "G10" });
    expect(protocol.node.callsTo("mint").filter((c) => c.mutating)).toHaveLength(1);
  });

  it("requires succession to name the issuer's current file", async () => {
    const first = draftFor();
    const minted = await client.mint(first, await sign(first));
    const orphan = draftFor({ resource: { identifier: ISSUER, name: "Second" } });
    await expect(client.mint(orphan, await sign(orphan))).rejects.toMatchObject({ rule: 11 });

    const successor = draftFor({ resource: { identifier: ISSUER, name: "Second" }, supersedes: minted.notaId });
    const next = await client.mint(successor, await sign(successor));
    expect(await reader.headOf(minted.resourceId, ISSUER)).toBe(next.notaId);
    expect((await reader.getNota(minted.notaId))?.status).toBe(NotaStatus.SUPERSEDED);
    expect((await reader.getNota(minted.notaId))?.supersededBy).toBe(next.notaId);
  });

  it("needs a signer", async () => {
    const draft = draftFor();
    await expect(reader.mint(draft, await sign(draft))).rejects.toBeInstanceOf(SignerRequiredError);
  });

  it("returns from back-to-back mints on a chain that mines only on demand", async () => {
    // A development node mines only when there is a transaction, and a stock ethers
    // provider answers eth_blockNumber from a 250 ms cache. The client must not need
    // a further block to see its own mint as confirmed.
    const stock = deployProtocol(new FakeNode(250));
    const minter = new RegistryClient(ADDRESSES.notaRegistry, stock.node, stock.wallet());
    for (const identifier of [ISSUER, OTHER, CONTRACT]) {
      const draft = draftFor({ type: "contract", resource: { identifier } }, stock.node.timestamp);
      const minted = await minter.mint(draft, await sign(draft));
      expect(minted.blockNumber).toBe(stock.node.height);
    }
  }, 3_000);

  it("gives up after the timeout when the transaction never confirms", async () => {
    const failure = await reader
      .mintedFromTransaction("0x" + "42".repeat(32), { timeout: 40 })
      .catch((e) => e);
    expect(failure).toBeInstanceOf(ContractCallError);
    expect(failure.message).toMatch(/did not reach 1 confirmation/);
  });
});

describe("records", () => {
  it("returns null for a file that was never minted", async () => {
    expect(await reader.getNota("0x" + "ab".repeat(32))).toBeNull();
    expect(await reader.getResource("0x" + "ab".repeat(32))).toBeNull();
    expect(await reader.aliasInfo("nobody.nota")).toBeNull();
    expect(await reader.resolveAlias("nobody.nota")).toBe(NOTA_ZERO_HASH);
    expect(await reader.isLive("0x" + "ab".repeat(32))).toBe(false);
  });

  it("reads a record, its resource and its pointers", async () => {
    const draft = draftFor({ type: "contract", resource: { identifier: CONTRACT }, expiresAt: protocol.node.timestamp + 86_400 });
    const minted = await client.mint(draft, await sign(draft));

    expect(await reader.getNota(minted.notaId)).toEqual({
      notaId: minted.notaId,
      resourceId: minted.resourceId,
      issuer: ISSUER,
      metadataHash: NOTA_ZERO_HASH,
      supersedes: NOTA_ZERO_HASH,
      supersededBy: NOTA_ZERO_HASH,
      status: NotaStatus.REGISTERED,
      level: VerificationLevel.BASIC,
      controlProof: "claimed",
      ruleset: 1,
      mintedAt: protocol.node.timestamp,
      expiresAt: draft.content.expiresAt,
      updatedAt: protocol.node.timestamp,
    });
    expect(await reader.getResource(minted.resourceId)).toEqual({
      resourceId: minted.resourceId,
      resourceType: 2,
      typeName: "contract",
      chainId: 1n,
      identifier: CONTRACT,
      canonical: NOTA_ZERO_HASH,
    });
    expect(await reader.headOf(minted.resourceId, ISSUER)).toBe(minted.notaId);
    expect(await reader.canonicalOf(minted.resourceId)).toBe(NOTA_ZERO_HASH);
    expect(await reader.isLive(minted.notaId)).toBe(true);
    expect(await reader.isVerifiable(minted.notaId)).toBe(true);
    expect(await reader.canonicalHeldByOther(minted.notaId)).toBe(false);
  });

  it("revokes as the issuer only", async () => {
    const draft = draftFor();
    const minted = await client.mint(draft, await sign(draft));

    const stranger = new RegistryClient(ADDRESSES.notaRegistry, protocol.node, protocol.wallet(OTHER_KEY));
    const refused = await stranger.revoke(minted.notaId).catch((e) => e);
    expect(refused).toBeInstanceOf(ContractCallError);
    expect(refused.revertName).toBe("NotIssuer");

    await client.revoke(minted.notaId);
    expect((await reader.getNota(minted.notaId))?.status).toBe(NotaStatus.REVOKED);
    expect(await reader.isLive(minted.notaId)).toBe(false);
    await expect(reader.revoke(minted.notaId)).rejects.toBeInstanceOf(SignerRequiredError);
  });

  it("refuses identifiers that are not 32 bytes", async () => {
    await expect(reader.getNota("0x1234")).rejects.toThrow(/32-byte/);
    await expect(reader.headOf("alice.nota", ISSUER)).rejects.toThrow(/32-byte/);
  });
});

describe("identifiers", () => {
  it("agrees with the registry on notaId and resourceId", async () => {
    const draft = draftFor();
    expect(await reader.computeNotaId(draft.content)).toBe(await reader.hashNota(draft.content));
    expect(reader.computeResourceId(0, 1, ISSUER)).toBe(await reader.computeResourceIdOnChain(0, 1, ISSUER));
  });

  it("computes resource IDs for governance-added types", () => {
    expect(reader.computeResourceId(42, 1n, "anything")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(() => reader.computeResourceId(255, 1, "x")).toThrow(RangeError);
    expect(() => reader.computeResourceId(0, 1, "")).toThrow(RangeError);
  });
});

describe("reconstruction and listing", () => {
  it("rebuilds a file byte for byte from its NotaMinted event", async () => {
    const draft = draftFor({ metadata: { ens: "example.eth" }, resource: { identifier: ISSUER, name: "Treasury" } });
    const minted = await client.mint(draft, await sign(draft));
    protocol.node.mine(5);
    const rebuilt = await reader.reconstruct(minted.notaId);
    expect(Buffer.from(rebuilt).equals(Buffer.from(minted.file))).toBe(true);
  });

  it("does not find a file that was never minted", async () => {
    await expect(reader.reconstruct("0x" + "cd".repeat(32))).rejects.toBeInstanceOf(NotaNotFoundError);
  });

  it("writes the file of a mint sent by something else", async () => {
    const draft = draftFor();
    const minted = await client.mint(draft, await sign(draft));
    const again = await reader.mintedFromTransaction(minted.transactionHash);
    expect(again.notaId).toBe(minted.notaId);
    expect(Buffer.from(again.file).equals(Buffer.from(minted.file))).toBe(true);
  });

  it("lists mints by issuer, newest first", async () => {
    const a = draftFor();
    const b = draftFor({ type: "contract", resource: { identifier: CONTRACT, name: "Vault" } });
    const first = await client.mint(a, await sign(a));
    const second = await client.mint(b, await sign(b));

    const mine = await reader.listMinted({ issuer: ISSUER });
    expect(mine.map((m) => m.notaId)).toEqual([second.notaId, first.notaId]);
    expect(mine[0]).toMatchObject({
      type: "contract",
      identifier: CONTRACT,
      name: "Vault",
      issuer: ISSUER,
      controlProof: "claimed",
      chain: { name: "ethereum", chainId: 1n, network: "mainnet" },
      transactionHash: second.transactionHash,
    });
    expect(await reader.listMinted({ issuer: OTHER })).toEqual([]);
    expect((await reader.listMinted({ resourceId: first.resourceId })).map((m) => m.notaId)).toEqual([first.notaId]);
  });
});

describe("resource types", () => {
  it("reads the type registry", async () => {
    expect(await reader.isValidResourceType(0)).toBe(true);
    expect(await reader.getResourceTypeName(3)).toBe("ipfs");
  });

  it("guards governance writes behind a signer", async () => {
    await expect(reader.addResourceType(10, "domain")).rejects.toBeInstanceOf(SignerRequiredError);
    expect(await client.addResourceType(10, "domain")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await client.removeResourceType(10)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("v1.0 surface", () => {
  it("is gone", () => {
    for (const removed of ["registerResource", "revokeResource", "updateResource", "registerAlias"]) {
      expect(client).not.toHaveProperty(removed);
    }
  });
});
