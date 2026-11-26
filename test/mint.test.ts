/**
 * The provider-free mint helpers: what an application using wagmi or viem
 * builds its own flow from.
 */

import { Interface, Signature, Wallet } from "ethers";
import { describe, expect, it } from "vitest";
import { NotareumNotaRegistryABI } from "../src/abi/index.js";
import {
  NotaConformanceError,
  NotaSignatureError,
  composeNotaDraft,
  computeNotaId,
  computeNotaResourceId,
  readNota,
  signNotaContent,
} from "../src/core/index.js";
import {
  GATE_RULES,
  NOTA_MINTED_TOPIC,
  describeGateRule,
  findNotaMintedLog,
  mintArguments,
  notaFileFromMintLog,
  notaTypedData,
  signatureFromWallet,
  suggestNotaFileName,
  summarizeNotaMintedLog,
  toNotaStruct,
} from "../src/mint.js";
import type { MintLog } from "../src/mint.js";
import { ISSUER, ISSUER_KEY, OTHER, OTHER_KEY, REGISTRY } from "./helpers/protocol.js";

const ISSUED_AT = 1_800_000_000;
const draft = composeNotaDraft({
  type: "address",
  chain: { name: "ethereum", chainId: 1 },
  resource: { identifier: ISSUER, name: "Treasury", alias: "treasury.nota" },
  issuer: { account: ISSUER },
  metadata: { tags: ["treasury"] },
  issuedAt: ISSUED_AT,
});
const notaId = computeNotaId(draft.content, REGISTRY);
const registryInterface = new Interface(NotareumNotaRegistryABI);

/** The log a registry emits for the draft, as a JSON-RPC node returns it. */
async function mintLog(overrides: Partial<MintLog> = {}): Promise<MintLog> {
  const signature = await signNotaContent(draft.content, REGISTRY, ISSUER_KEY);
  const [struct, metadata, signatureHex] = mintArguments(draft, signature);
  const encoded = registryInterface.encodeEventLog("NotaMinted", [
    notaId,
    computeNotaResourceId(draft.content),
    ISSUER,
    1,
    1,
    struct,
    metadata,
    signatureHex,
  ]);
  return {
    address: REGISTRY.address,
    topics: encoded.topics,
    data: encoded.data,
    blockNumber: 1234,
    transactionHash: "0x" + "ab".repeat(32),
    index: 7,
    ...overrides,
  };
}

describe("gate rules", () => {
  it("describes G1 through G13", () => {
    expect(Object.keys(GATE_RULES)).toHaveLength(13);
    for (let rule = 1; rule <= 13; rule++) {
      expect(GATE_RULES[rule].id).toBe(`G${rule}`);
      expect(describeGateRule(rule).length).toBeGreaterThan(20);
    }
    expect(describeGateRule(99)).toMatch(/rule 99/);
  });
});

describe("calldata", () => {
  it("maps the content onto the Solidity struct", () => {
    expect(toNotaStruct(draft.content)).toEqual({
      version: "1.1",
      type_: "address",
      chain: { name: "ethereum", chainId: 1n, network: "mainnet" },
      resource: { identifier: ISSUER, name: "Treasury", alias_: "treasury.nota", description: "" },
      issuer: { account: ISSUER, name: "", entityType: "" },
      metadataHash: draft.content.metadataHash,
      supersedes: "0x" + "00".repeat(32),
      issuedAt: BigInt(ISSUED_AT),
      expiresAt: 0n,
    });
  });

  it("encodes against the registry's mint and decodes to the same content", () => {
    const args = mintArguments(draft, "0xABCD");
    expect(args[1]).toBe("0x" + Buffer.from('{"tags":["treasury"]}').toString("hex"));
    expect(args[2]).toBe("0xabcd");
    const data = registryInterface.encodeFunctionData("mint", [...args]);
    const decoded = registryInterface.decodeFunctionData("mint", data);
    expect(decoded[0].toObject(true)).toEqual(args[0]);
  });

  it("defaults to an unsigned preflight and refuses malformed signatures", () => {
    expect(mintArguments(composeNotaDraft({ ...baseInput(), metadata: null }))[1]).toBe("0x");
    expect(mintArguments(draft)[2]).toBe("0x");
    expect(() => mintArguments(draft, "abc")).toThrow(NotaSignatureError);
  });
});

function baseInput() {
  return {
    type: "address",
    chain: { name: "ethereum", chainId: 1 },
    resource: { identifier: ISSUER },
    issuer: { account: ISSUER },
    issuedAt: ISSUED_AT,
  };
}

describe("typed data", () => {
  it("offers nothing non-conforming for signing", () => {
    expect(() => notaTypedData({ ...draft.content, version: "1.0" }, REGISTRY)).toThrow(NotaConformanceError);
  });

  it("normalizes a wallet signature with v of 0 or 1", async () => {
    const typed = notaTypedData(draft.content, REGISTRY);
    const raw = await new Wallet(ISSUER_KEY).signTypedData(typed.domain, typed.types, typed.message);
    const parsed = Signature.from(raw);
    // Some hardware wallets return the recovery bit instead of 27 or 28.
    const recoveryBit = raw.slice(0, 130) + (parsed.yParity === 0 ? "00" : "01");
    expect(signatureFromWallet(recoveryBit, draft.content, REGISTRY, false)).toEqual({
      scheme: "eip712-secp256k1",
      signature: raw.toLowerCase(),
      signer: ISSUER,
    });
    expect(signatureFromWallet(raw.toUpperCase().replace("0X", "0x"), draft.content, REGISTRY, false).signature).toBe(
      raw.toLowerCase()
    );
  });

  it("refuses a signature that is not the issuer's, or not a signature", async () => {
    const typed = notaTypedData(draft.content, REGISTRY);
    const foreign = await new Wallet(OTHER_KEY).signTypedData(typed.domain, typed.types, typed.message);
    expect(() => signatureFromWallet(foreign, draft.content, REGISTRY, false)).toThrow(/not from issuer.account/);
    expect(() => signatureFromWallet("0x1234", draft.content, REGISTRY, false)).toThrow(NotaSignatureError);
  });
});

describe("the NotaMinted event", () => {
  it("writes the file from an ethers log and from a viem log alike", async () => {
    const context = { registry: REGISTRY, blockTimestamp: ISSUED_AT + 12, issuerHasCode: false };
    const fromEthers = notaFileFromMintLog(await mintLog(), context);
    const fromViem = notaFileFromMintLog(
      await mintLog({ index: undefined, logIndex: 7, blockNumber: 1234n }),
      { ...context, blockTimestamp: BigInt(ISSUED_AT + 12) }
    );
    expect(Buffer.from(fromViem).equals(Buffer.from(fromEthers))).toBe(true);

    const nota = readNota(fromEthers, { trustedRegistries: [REGISTRY] });
    expect(nota.notaId).toBe(notaId);
    expect(nota.receipt).toMatchObject({ blockNumber: 1234, logIndex: 7, mintedAt: ISSUED_AT + 12 });
    expect(nota.signature.scheme).toBe("eip712-secp256k1");
  });

  it("ignores a look-alike event from any other contract", async () => {
    const real = await mintLog();
    const impostor = await mintLog({ address: OTHER });
    expect(findNotaMintedLog([impostor, real], REGISTRY.address)).toBe(real);
    expect(findNotaMintedLog([impostor], REGISTRY.address)).toBeNull();
    expect(findNotaMintedLog([real], REGISTRY.address, "0x" + "00".repeat(32))).toBeNull();
    expect(findNotaMintedLog([real], REGISTRY.address.toLowerCase(), notaId.toUpperCase().replace("0X", "0x"))).toBe(real);
    expect(real.topics[0]).toBe(NOTA_MINTED_TOPIC);
    expect(() =>
      notaFileFromMintLog(impostor, { registry: REGISTRY, blockTimestamp: ISSUED_AT, issuerHasCode: false })
    ).toThrow(/not by the registry/);
  });

  it("refuses a log that has not been mined", async () => {
    const pending = await mintLog({ blockNumber: null });
    expect(() =>
      notaFileFromMintLog(pending, { registry: REGISTRY, blockTimestamp: ISSUED_AT, issuerHasCode: false })
    ).toThrow(/not been mined/);
  });

  it("refuses a receipt the content could not have produced", async () => {
    // Minted two days after it was signed: outside the gate's window, so no gate emitted this.
    const log = await mintLog();
    expect(() =>
      notaFileFromMintLog(log, {
        registry: REGISTRY,
        blockTimestamp: ISSUED_AT + 2 * 86_400,
        issuerHasCode: false,
      })
    ).toThrow(NotaConformanceError);
  });

  it("summarizes a log for listings", async () => {
    expect(summarizeNotaMintedLog(await mintLog())).toEqual({
      notaId,
      resourceId: computeNotaResourceId(draft.content),
      issuer: ISSUER,
      ruleset: 1,
      controlProof: "self",
      type: "address",
      chain: { name: "ethereum", chainId: 1n, network: "mainnet" },
      identifier: ISSUER,
      name: "Treasury",
      alias: "treasury.nota",
      description: "",
      issuerName: "",
      supersedes: "0x" + "00".repeat(32),
      issuedAt: ISSUED_AT,
      expiresAt: 0,
      blockNumber: 1234,
      transactionHash: "0x" + "ab".repeat(32),
      logIndex: 7,
    });
  });

  it("suggests a file name", () => {
    expect(suggestNotaFileName(draft.content, notaId)).toBe("treasury.nota");
    const plain = { ...draft.content, resource: { ...draft.content.resource, alias: "" } };
    expect(suggestNotaFileName(plain, notaId)).toBe(`${notaId.slice(0, 18)}.nota`);
  });
});
