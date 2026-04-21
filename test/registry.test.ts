/**
 * Tests for RegistryClient.
 * Contract calls are mocked -- no live chain needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { RegistryClient } from "../src/clients/registry.js";
import { SignerRequiredError } from "../src/errors.js";

// Mock ethers Contract
vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ...actual,
    Contract: vi.fn().mockImplementation(() => ({
      register: vi.fn().mockResolvedValue({ hash: "0xtxhash" }),
      getResource: vi.fn().mockResolvedValue({
        owner: "0xowner",
        resourceType: 0n,
        chainId: 1n,
        identifier: new TextEncoder().encode("0xaddress"),
        alias_: "",
        verificationStatus: 0n,
        registeredAt: 1700000000n,
        proofHash: "0x" + "00".repeat(32),
      }),
      resolveAlias: vi.fn().mockResolvedValue("0x" + "aa".repeat(32)),
      revokeResource: vi.fn().mockResolvedValue({ hash: "0xrevokehash" }),
      addResourceType: vi.fn().mockResolvedValue({ hash: "0xaddtypehash" }),
      removeResourceType: vi.fn().mockResolvedValue({ hash: "0xremovetypehash" }),
      validResourceTypes: vi.fn().mockResolvedValue(true),
      resourceTypeNames: vi.fn().mockResolvedValue("ADDRESS"),
    })),
  };
});

const mockProvider = {} as unknown as import("ethers").Provider;
const mockSigner = {
  getAddress: vi.fn().mockResolvedValue("0xsigner"),
} as unknown as import("ethers").Signer;
const address = "0x" + "01".repeat(20);

describe("RegistryClient (read-only)", () => {
  let client: RegistryClient;

  beforeEach(() => {
    client = new RegistryClient(address, mockProvider);
  });

  it("getResource() returns ResourceInfo", async () => {
    const info = await client.getResource("0x" + "aa".repeat(32));
    expect(info.owner).toBe("0xowner");
    expect(info.resourceType).toBe(0);
    expect(info.chainId).toBe(1n);
  });

  it("resolveAlias() returns a resource ID", async () => {
    const id = await client.resolveAlias("alice.nota");
    expect(id).toMatch(/^0x/);
  });

  it("isValidResourceType() returns boolean", async () => {
    const valid = await client.isValidResourceType(0);
    expect(valid).toBe(true);
  });

  it("getResourceTypeName() returns name string", async () => {
    const name = await client.getResourceTypeName(0);
    expect(name).toBe("ADDRESS");
  });

  it("computeResourceId() computes locally without RPC", () => {
    const id = client.computeResourceId(0, 1, "0xtest");
    expect(id).toMatch(/^0x[a-f0-9]{64}$/);
  });
});

describe("RegistryClient (write ops)", () => {
  let client: RegistryClient;

  beforeEach(() => {
    client = new RegistryClient(address, mockProvider, mockSigner);
  });

  it("registerResource() returns tx hash", async () => {
    const hash = await client.registerResource(0, 1n, "0xaddress", "0x" + "00".repeat(32));
    expect(hash).toBe("0xtxhash");
  });

  it("revokeResource() returns tx hash", async () => {
    const hash = await client.revokeResource("0x" + "aa".repeat(32));
    expect(hash).toBe("0xrevokehash");
  });

  it("addResourceType() returns tx hash", async () => {
    const hash = await client.addResourceType(10, "DOMAIN");
    expect(hash).toBe("0xaddtypehash");
  });

  it("removeResourceType() returns tx hash", async () => {
    const hash = await client.removeResourceType(10);
    expect(hash).toBe("0xremovetypehash");
  });
});

describe("RegistryClient (signer guard)", () => {
  it("registerResource() throws SignerRequiredError without signer", async () => {
    const client = new RegistryClient(address, mockProvider);
    await expect(client.registerResource(0, 1n, "0x", "0x" + "00".repeat(32)))
      .rejects.toBeInstanceOf(SignerRequiredError);
  });

  it("revokeResource() throws SignerRequiredError without signer", async () => {
    const client = new RegistryClient(address, mockProvider);
    await expect(client.revokeResource("0x" + "aa".repeat(32)))
      .rejects.toBeInstanceOf(SignerRequiredError);
  });
});
