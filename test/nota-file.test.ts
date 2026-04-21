/**
 * Tests for NotaFileClient -- wraps @notareum/core, fully testable without a chain.
 */

import { describe, it, expect } from "vitest";
import { NotaFileClient, NotaBuilder } from "../src/clients/nota-file.js";
import { ResourceType } from "../src/core/index.js";

const client = new NotaFileClient();

describe("NotaFileClient.create()", () => {
  it("creates a NotaBuilder for a well-known type", () => {
    const builder = client.create({
      type: "address",
      chainId: 1,
      chainName: "ethereum",
      identifier: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    });
    expect(builder).toBeInstanceOf(NotaBuilder);
  });

  it("throws for an unknown resource type", () => {
    expect(() =>
      client.create({
        type: "unknown-type-xyz",
        chainId: 1,
        chainName: "ethereum",
        identifier: "0x1234",
      })
    ).toThrow(/Unknown resource type/);
  });

  it("builds with all optional fields", () => {
    const builder = client.create({
      type: "contract",
      chainId: 11155111,
      chainName: "ethereum",
      network: "sepolia",
      identifier: "0x742d35Cc6634C0532925a3b8D4C9C5b0A5E6F789",
      name: "My Contract",
      description: "A test contract",
      resourceMetadata: { version: "1.0.0" },
      issuerName: "Acme Corp",
      issuerEntityType: "organization",
    });
    expect(builder).toBeInstanceOf(NotaBuilder);
    const nota = builder.build();
    expect(nota.type).toBe("contract");
    expect(nota.chain.chainId).toBe(11155111);
  });
});

describe("NotaBuilder", () => {
  it("validate() passes for a signed nota", async () => {
    const { Wallet } = await import("ethers");
    const wallet = Wallet.createRandom();
    const builder = client.create({
      type: "address",
      chainId: 1,
      chainName: "ethereum",
      identifier: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    });
    const signed = await builder.sign(wallet);
    expect(() => signed.validate()).not.toThrow();
  });

  it("build() returns a NotaFile", () => {
    const nota = client
      .create({
        type: "nft",
        chainId: 1,
        chainName: "ethereum",
        identifier: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D/1",
      })
      .build();
    expect(nota.version).toBe("1.0");
    expect(nota.type).toBe("nft");
  });

  it("serialize() returns a JSON string", () => {
    const json = client
      .create({
        type: "ipfs",
        chainId: 1,
        chainName: "ethereum",
        identifier: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
      })
      .serialize();
    expect(typeof json).toBe("string");
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("ipfs");
  });

  it("sign() attaches a valid ECDSA signature", async () => {
    const { Wallet } = await import("ethers");
    const wallet = Wallet.createRandom();
    const builder = client.create({
      type: "address",
      chainId: 1,
      chainName: "ethereum",
      identifier: wallet.address,
    });
    const signed = await builder.sign(wallet);
    const nota = signed.build();
    expect(nota.signature).toBeDefined();
    expect(nota.signature?.algorithm).toBe("ECDSA");
    expect(nota.signature?.address).toBe(wallet.address);
    expect(nota.signature?.signature).toMatch(/^0x/);
  });
});

describe("NotaFileClient.parse()", () => {
  it("parses a valid .nota JSON string", () => {
    const raw = client
      .create({
        type: "address",
        chainId: 1,
        chainName: "ethereum",
        identifier: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      })
      .serialize();
    const parsed = client.parse(raw);
    expect(parsed.type).toBe("address");
    expect(parsed.chain.chainId).toBe(1);
  });

  it("throws on malformed JSON", () => {
    expect(() => client.parse("not json")).toThrow();
  });
});

describe("NotaFileClient.validate()", () => {
  it("validates a signed nota without throwing", async () => {
    const { Wallet } = await import("ethers");
    const wallet = Wallet.createRandom();
    const nota = await client
      .create({
        type: "address",
        chainId: 1,
        chainName: "ethereum",
        identifier: "0x1234567890abcdef1234567890abcdef12345678",
      })
      .sign(wallet)
      .then(b => b.build());
    expect(() => client.validate(nota)).not.toThrow();
  });
});

describe("NotaFileClient.isValid()", () => {
  it("returns true for a signed nota", async () => {
    const { Wallet } = await import("ethers");
    const wallet = Wallet.createRandom();
    const nota = await client
      .create({
        type: "transaction",
        chainId: 1,
        chainName: "ethereum",
        identifier: "0x" + "ab".repeat(32),
      })
      .sign(wallet)
      .then(b => b.build());
    expect(client.isValid(nota)).toBe(true);
  });

  it("returns false for an unsigned nota", () => {
    const nota = client
      .create({
        type: "transaction",
        chainId: 1,
        chainName: "ethereum",
        identifier: "0x" + "ab".repeat(32),
      })
      .build();
    // Empty signature address makes it invalid
    expect(client.isValid(nota)).toBe(false);
  });
});

describe("NotaFileClient.ResourceType", () => {
  it("exposes well-known type constants", () => {
    expect(client.ResourceType.ADDRESS).toBe(0);
    expect(client.ResourceType.TRANSACTION).toBe(1);
    expect(client.ResourceType.CONTRACT).toBe(2);
    expect(client.ResourceType.IPFS).toBe(3);
    expect(client.ResourceType.NFT).toBe(4);
    expect(client.ResourceType.METADATA).toBe(5);
  });
});
