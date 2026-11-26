/**
 * EIP-712 hashing and signing of the content layer.
 */

import { describe, it, expect } from "vitest";
import { TypedDataEncoder, Wallet, concat, keccak256 } from "ethers";
import {
  NOTA_EIP712_TYPES,
  NOTA_EIP712_TYPE_HASH,
  NOTA_EIP712_TYPE_STRING,
  checkEcdsaSignature,
  computeNotaId,
  hashNotaStruct,
  notaDomain,
  notaDomainSeparator,
  recoverNotaSigner,
  signNotaContent,
  verifyNotaSignature,
} from "../../../src/core/crypto/index.js";
import { NotaConformanceError, NotaSignatureError } from "../../../src/core/errors.js";
import {
  EXAMPLE_NOTA_ID,
  EXAMPLE_TYPE_HASH,
  ISSUER,
  REGISTRY,
  TEST_PRIVATE_KEY,
  exampleContent,
  loadExample,
  plainContent,
  signatureOf,
} from "../fixtures.js";

const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describe("Nota typed data", () => {
  it("has the type string of the specification", () => {
    expect(NOTA_EIP712_TYPE_STRING).toBe(
      "Nota(string version,string type,Chain chain,Resource resource,Issuer issuer,bytes32 metadataHash,bytes32 supersedes,uint64 issuedAt,uint64 expiresAt)" +
        "Chain(string name,uint256 chainId,string network)" +
        "Issuer(address account,string name,string entityType)" +
        "Resource(string identifier,string name,string alias,string description)"
    );
    expect(TypedDataEncoder.from(NOTA_EIP712_TYPES).encodeType("Nota")).toBe(NOTA_EIP712_TYPE_STRING);
    expect(TypedDataEncoder.from(NOTA_EIP712_TYPES).primaryType).toBe("Nota");
    expect(NOTA_EIP712_TYPE_HASH).toBe(EXAMPLE_TYPE_HASH);
  });

  it("uses the domain of the registry deployment", () => {
    expect(notaDomain(REGISTRY)).toEqual({
      name: "Notareum",
      version: "1.1",
      chainId: 11155111,
      verifyingContract: "0x0000000000000000000000000000000000001101",
    });
    expect(() => notaDomain({ chainId: 0, address: REGISTRY.address })).toThrow(NotaConformanceError);
    expect(() => notaDomain({ chainId: 1, address: ISSUER.toLowerCase() })).toThrow(NotaConformanceError);
  });
});

describe("computeNotaId", () => {
  it("yields the notaId of the worked example", () => {
    expect(computeNotaId(exampleContent(), REGISTRY)).toBe(EXAMPLE_NOTA_ID);
  });

  it("is keccak256(0x1901 || domainSeparator || hashStruct(Nota))", () => {
    const content = exampleContent();
    const manual = keccak256(concat(["0x1901", notaDomainSeparator(REGISTRY), hashNotaStruct(content)]));
    expect(manual).toBe(EXAMPLE_NOTA_ID);
  });

  it("is bound to the registry deployment, so a request cannot be replayed elsewhere", () => {
    const content = exampleContent();
    expect(computeNotaId(content, { chainId: 1, address: REGISTRY.address })).not.toBe(EXAMPLE_NOTA_ID);
    expect(
      computeNotaId(content, { chainId: REGISTRY.chainId, address: "0x0000000000000000000000000000000000002202" })
    ).not.toBe(EXAMPLE_NOTA_ID);
  });

  it("commits to every member of the content", () => {
    const base = computeNotaId(plainContent(), REGISTRY);
    const variants = [
      plainContent({ type: "contract" }),
      plainContent({ chain: { name: "polygon", chainId: 1, network: "mainnet" } }),
      plainContent({ chain: { name: "ethereum", chainId: 137, network: "mainnet" } }),
      plainContent({ chain: { name: "ethereum", chainId: 1, network: "testnet" } }),
      plainContent({ resource: { ...plainContent().resource, name: "Other" } }),
      plainContent({ resource: { ...plainContent().resource, alias: "other.nota" } }),
      plainContent({ resource: { ...plainContent().resource, description: "" } }),
      plainContent({ issuer: { ...plainContent().issuer, name: "Other" } }),
      plainContent({ issuer: { ...plainContent().issuer, entityType: "individual" } }),
      plainContent({ metadataHash: "0x" + "01".repeat(32) }),
      plainContent({ supersedes: "0x" + "02".repeat(32) }),
      plainContent({ issuedAt: 1795564801 }),
      plainContent({ expiresAt: 1999999999 }),
    ];
    const ids = new Set(variants.map((v) => computeNotaId(v, REGISTRY)));
    expect(ids.size).toBe(variants.length);
    expect(ids.has(base)).toBe(false);
  });

  it("is defined only for conforming content", () => {
    expect(() => computeNotaId(plainContent({ version: "1.0" }), REGISTRY)).toThrow(NotaConformanceError);
    expect(() => computeNotaId({ ...plainContent(), extra: 1 } as never, REGISTRY)).toThrow(NotaConformanceError);
    const { expiresAt: _dropped, ...missing } = plainContent();
    expect(() => computeNotaId(missing as never, REGISTRY)).toThrow(NotaConformanceError);
  });
});

describe("signNotaContent", () => {
  it("reproduces the signature in the example file", async () => {
    const expected = signatureOf(loadExample("address-registered.nota"));
    expect(await signNotaContent(exampleContent(), REGISTRY, TEST_PRIVATE_KEY)).toEqual(expected);
    expect(await signNotaContent(exampleContent(), REGISTRY, new Wallet(TEST_PRIVATE_KEY))).toEqual(expected);
  });

  it("produces a payload the gate accepts: 65 bytes, lowercase, low s", async () => {
    const signature = await signNotaContent(plainContent(), REGISTRY, TEST_PRIVATE_KEY);
    expect(signature.scheme).toBe("eip712-secp256k1");
    expect(signature.signer).toBe(ISSUER);
    expect(checkEcdsaSignature(signature.signature)).toBeNull();
    expect(verifyNotaSignature(plainContent(), REGISTRY, signature)).toBe(true);
  });

  it("refuses to sign as anyone but the issuer", async () => {
    await expect(signNotaContent(plainContent(), REGISTRY, OTHER_KEY)).rejects.toThrow(NotaSignatureError);
    await expect(signNotaContent(plainContent(), REGISTRY, OTHER_KEY)).rejects.toThrow(/issuer account must sign/);
  });

  it("refuses to sign content the gate would refuse", async () => {
    const content = plainContent();
    content.resource.name = "trailing space ";
    await expect(signNotaContent(content, REGISTRY, TEST_PRIVATE_KEY)).rejects.toThrow(NotaConformanceError);
  });

  it("reports an invalid private key without echoing it", async () => {
    const bad = "0xnot-a-key-5555";
    const error = await signNotaContent(plainContent(), REGISTRY, bad).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotaSignatureError);
    expect((error as Error).message).not.toContain("5555");
  });

  it("normalizes a v of 0 or 1 from an external signer to 27 or 28", async () => {
    const wallet = new Wallet(TEST_PRIVATE_KEY);
    const legacyV = {
      async signTypedData(...args: Parameters<Wallet["signTypedData"]>): Promise<string> {
        const sig = await wallet.signTypedData(...args);
        return sig.slice(0, 130) + (sig.endsWith("1b") ? "00" : "01");
      },
    };
    const signature = await signNotaContent(plainContent(), REGISTRY, legacyV);
    expect(signature).toEqual(await signNotaContent(plainContent(), REGISTRY, wallet));
  });
});

describe("recoverNotaSigner", () => {
  it("recovers the issuer of the example", () => {
    const { signature } = signatureOf(loadExample("address-registered.nota"));
    expect(recoverNotaSigner(EXAMPLE_NOTA_ID, signature)).toBe(ISSUER);
  });

  it("recovers a different address for a different digest", () => {
    const { signature } = signatureOf(loadExample("address-registered.nota"));
    expect(recoverNotaSigner("0x" + "11".repeat(32), signature)).not.toBe(ISSUER);
  });

  it("refuses malformed and malleable signatures", () => {
    const { signature } = signatureOf(loadExample("address-registered.nota"));
    const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const s = BigInt("0x" + signature.slice(66, 130));
    const highS =
      signature.slice(0, 66) + (n - s).toString(16).padStart(64, "0") + (signature.endsWith("1b") ? "1c" : "1b");
    for (const bad of [
      highS,
      signature.slice(0, 130) + "00",
      signature.slice(0, 130) + "25",
      signature.slice(0, 130),
      "0x" + signature.slice(2).toUpperCase(),
      "0x",
      "",
    ]) {
      expect(() => recoverNotaSigner(EXAMPLE_NOTA_ID, bad), bad).toThrow(NotaSignatureError);
    }
    expect(() => recoverNotaSigner("0x1234", signature)).toThrow(NotaSignatureError);
    expect(checkEcdsaSignature(highS)).toMatch(/lower half/);
    expect(checkEcdsaSignature(42)).not.toBeNull();
  });
});

describe("verifyNotaSignature", () => {
  it("is false for anything but the issuer's own signature over this content", async () => {
    const content = plainContent();
    const signature = await signNotaContent(content, REGISTRY, TEST_PRIVATE_KEY);
    expect(verifyNotaSignature(content, REGISTRY, signature)).toBe(true);
    expect(verifyNotaSignature(plainContent({ issuedAt: 1 }), REGISTRY, signature)).toBe(false);
    expect(verifyNotaSignature(content, { chainId: 1, address: REGISTRY.address }, signature)).toBe(false);
    expect(verifyNotaSignature(content, REGISTRY, { ...signature, signer: new Wallet(OTHER_KEY).address })).toBe(false);
    expect(verifyNotaSignature(content, REGISTRY, { ...signature, scheme: "erc1271" })).toBe(false);
    expect(verifyNotaSignature(content, REGISTRY, { ...signature, signature: "0x00" })).toBe(false);
  });
});
