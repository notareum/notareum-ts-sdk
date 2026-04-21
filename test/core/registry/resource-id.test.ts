import { describe, it, expect } from "vitest";
import { computeResourceId } from "../../../src/core/registry/resource-id.js";
import { ResourceType } from "../../../src/core/nota/types.js";
import { computeResourceIdHash } from "../../../src/core/crypto/hash.js";
import { ResourceIdError } from "../../../src/core/errors.js";

describe("computeResourceId", () => {
  it("computes the same result as computeResourceIdHash for ADDRESS", () => {
    const expected = computeResourceIdHash(
      ResourceType.ADDRESS,
      1,
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
    );
    const result = computeResourceId(
      ResourceType.ADDRESS,
      1,
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
    );
    expect(result).toBe(expected);
  });

  it("computes resource IDs for all resource types", () => {
    const cases: Array<[ResourceType, number, string]> = [
      [ResourceType.ADDRESS, 1, "0xaddress"],
      [ResourceType.TRANSACTION, 1, "0xtxhash"],
      [ResourceType.CONTRACT, 1, "0xcontract"],
      [ResourceType.IPFS, 0, "QmHash123"],
      [ResourceType.NFT, 1, "0xnftcontract:42"],
      [ResourceType.METADATA, 1, "0xmetadata"],
    ];

    for (const [type, chainId, id] of cases) {
      const result = computeResourceId(type, chainId, id);
      expect(result).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it("produces different IDs for different resource types", () => {
    const ids = [
      computeResourceId(ResourceType.ADDRESS, 1, "same"),
      computeResourceId(ResourceType.TRANSACTION, 1, "same"),
      computeResourceId(ResourceType.CONTRACT, 1, "same"),
    ];
    const unique = new Set(ids);
    expect(unique.size).toBe(3);
  });

  it("produces different IDs for different chain IDs", () => {
    const id1 = computeResourceId(ResourceType.ADDRESS, 1, "0xaddr");
    const id137 = computeResourceId(ResourceType.ADDRESS, 137, "0xaddr");
    const id56 = computeResourceId(ResourceType.ADDRESS, 56, "0xaddr");
    expect(id1).not.toBe(id137);
    expect(id1).not.toBe(id56);
  });

  it("produces different IDs for different identifiers", () => {
    const h1 = computeResourceId(ResourceType.ADDRESS, 1, "0xaaa");
    const h2 = computeResourceId(ResourceType.ADDRESS, 1, "0xbbb");
    expect(h1).not.toBe(h2);
  });

  it("is deterministic", () => {
    const r1 = computeResourceId(ResourceType.CONTRACT, 42, "0xcontract");
    const r2 = computeResourceId(ResourceType.CONTRACT, 42, "0xcontract");
    expect(r1).toBe(r2);
  });

  it("works with bigint chainId", () => {
    const r1 = computeResourceId(ResourceType.ADDRESS, 1, "0xtest");
    const r2 = computeResourceId(ResourceType.ADDRESS, 1n, "0xtest");
    expect(r1).toBe(r2);
  });

  it("throws ResourceIdError for empty identifier", () => {
    expect(() => computeResourceId(ResourceType.ADDRESS, 1, "")).toThrow(
      ResourceIdError
    );
  });

  it("throws ResourceIdError for whitespace-only identifier", () => {
    expect(() => computeResourceId(ResourceType.ADDRESS, 1, "   ")).toThrow(
      ResourceIdError
    );
  });

  it("computes correct ID for all ResourceType enum values", () => {
    for (const type of [0, 1, 2, 3, 4, 5] as ResourceType[]) {
      const result = computeResourceId(type, 1, "identifier");
      expect(result).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });
});
