import { describe, it, expect } from "vitest";
import { buildNota, buildUnsignedNota } from "../../../src/core/nota/builder.js";
import type { NotaMetadata, NotaSignature } from "../../../src/core/nota/types.js";

const baseMeta: NotaMetadata = {
  type: "address",
  chainName: "ethereum",
  chainId: 1,
  network: "mainnet",
  identifier: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  name: "Vitalik",
};

const mockSignature: NotaSignature = {
  algorithm: "ECDSA",
  curve: "secp256k1",
  address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  message: "Notareum v1.0 | address:1:0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  signature: "0x" + "a".repeat(130),
  timestamp: 1700000000,
};

describe("buildNota", () => {
  it("builds a complete NotaFile from metadata and signature", () => {
    const nota = buildNota(baseMeta, mockSignature);
    expect(nota.version).toBe("1.0");
    expect(nota.type).toBe("address");
    expect(nota.chain.name).toBe("ethereum");
    expect(nota.chain.chainId).toBe(1);
    expect(nota.chain.network).toBe("mainnet");
    expect(nota.resource.identifier).toBe(
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
    );
    expect(nota.resource.name).toBe("Vitalik");
    expect(nota.signature).toEqual(mockSignature);
  });

  it("defaults verification status to 'unverified'", () => {
    const nota = buildNota(baseMeta, mockSignature);
    expect(nota.verification?.status).toBe("unverified");
  });

  it("accepts custom verification state", () => {
    const nota = buildNota(baseMeta, mockSignature, {
      status: "verified",
      level: "basic",
    });
    expect(nota.verification?.status).toBe("verified");
    expect(nota.verification?.level).toBe("basic");
  });

  it("includes issuer when issuerName is provided", () => {
    const meta: NotaMetadata = {
      ...baseMeta,
      issuerName: "Notareum Labs",
      issuerEntityType: "organization",
    };
    const nota = buildNota(meta, mockSignature);
    expect(nota.issuer?.name).toBe("Notareum Labs");
    expect(nota.issuer?.entityType).toBe("organization");
    expect(nota.issuer?.address).toBe(mockSignature.address);
    expect(nota.issuer?.verified).toBe(false);
  });

  it("omits issuer when no issuer metadata provided", () => {
    const nota = buildNota(baseMeta, mockSignature);
    expect(nota.issuer).toBeUndefined();
  });

  it("includes optional resource fields when provided", () => {
    const meta: NotaMetadata = {
      ...baseMeta,
      alias: "vitalik.nota",
      description: "Vitalik's address",
      resourceMetadata: { tag: "founder" },
    };
    const nota = buildNota(meta, mockSignature);
    expect(nota.resource.alias).toBe("vitalik.nota");
    expect(nota.resource.description).toBe("Vitalik's address");
    expect(nota.resource.metadata).toEqual({ tag: "founder" });
  });

  it("omits optional resource fields when not provided", () => {
    const meta: NotaMetadata = {
      type: "transaction",
      chainName: "ethereum",
      chainId: 1,
      identifier: "0xabc123",
    };
    const nota = buildNota(meta, mockSignature);
    expect(nota.resource.alias).toBeUndefined();
    expect(nota.resource.description).toBeUndefined();
    expect(nota.resource.metadata).toBeUndefined();
    expect(nota.chain.network).toBeUndefined();
  });
});

describe("buildUnsignedNota", () => {
  it("builds a nota without a signature field", () => {
    const unsigned = buildUnsignedNota(baseMeta);
    expect("signature" in unsigned).toBe(false);
    expect(unsigned.version).toBe("1.0");
    expect(unsigned.type).toBe("address");
    expect(unsigned.verification?.status).toBe("unverified");
  });

  it("includes issuer address as empty string when issuer metadata provided", () => {
    const meta: NotaMetadata = {
      ...baseMeta,
      issuerName: "Test Issuer",
    };
    const unsigned = buildUnsignedNota(meta);
    expect(unsigned.issuer?.address).toBe("");
    expect(unsigned.issuer?.name).toBe("Test Issuer");
  });
});
