import { describe, it, expect } from "vitest";
import { computeResourceIdHash } from "../../../src/core/crypto/hash.js";
import { NotaHashError } from "../../../src/core/errors.js";

// Pre-computed expected values (verified against contract logic)
// Formula: keccak256(abi.encodePacked(uint8(type), uint256(chainId), bytes(identifier)))
const EXPECTED_VALUES: Array<{
  type: number;
  chainId: number | bigint;
  identifier: string;
  expected: string;
}> = [
  {
    type: 0,
    chainId: 1,
    identifier: "0xabc123",
    expected: "0xa760cac0d20587ec77ffce2db98ce442968f109a9f19aee753247c07da2cd1c5",
  },
  {
    type: 1,
    chainId: 1,
    identifier: "0xtxhash",
    expected: "0xd00c392c5c7c02227e8681f25edcb8c188397c36d49cca45e1cda86f6f839a75",
  },
];

describe("computeResourceIdHash", () => {
  it("computes expected keccak256 for ADDRESS type", () => {
    const result = computeResourceIdHash(0, 1, "0xabc123");
    expect(result).toBe(EXPECTED_VALUES[0].expected);
  });

  it("computes expected keccak256 for TRANSACTION type", () => {
    const result = computeResourceIdHash(1, 1, "0xtxhash");
    expect(result).toBe(EXPECTED_VALUES[1].expected);
  });

  it("produces a 0x-prefixed 32-byte hex string", () => {
    const result = computeResourceIdHash(0, 1, "0xabc");
    expect(result).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("returns different hashes for different resource types", () => {
    const hash0 = computeResourceIdHash(0, 1, "same");
    const hash1 = computeResourceIdHash(1, 1, "same");
    const hash2 = computeResourceIdHash(2, 1, "same");
    expect(hash0).not.toBe(hash1);
    expect(hash1).not.toBe(hash2);
  });

  it("returns different hashes for different chain IDs", () => {
    const hash1 = computeResourceIdHash(0, 1, "0xaddr");
    const hash137 = computeResourceIdHash(0, 137, "0xaddr");
    expect(hash1).not.toBe(hash137);
  });

  it("returns different hashes for different identifiers", () => {
    const h1 = computeResourceIdHash(0, 1, "0xaaa");
    const h2 = computeResourceIdHash(0, 1, "0xbbb");
    expect(h1).not.toBe(h2);
  });

  it("works with bigint chainId", () => {
    const resultNumber = computeResourceIdHash(0, 1, "0xtest");
    const resultBigint = computeResourceIdHash(0, 1n, "0xtest");
    expect(resultNumber).toBe(resultBigint);
  });

  it("works with all resource types 0-5", () => {
    for (let t = 0; t <= 5; t++) {
      expect(() => computeResourceIdHash(t, 1, "0xid")).not.toThrow();
    }
  });

  it("throws NotaHashError for invalid resource type", () => {
    expect(() => computeResourceIdHash(6, 1, "0xid")).toThrow(NotaHashError);
    expect(() => computeResourceIdHash(-1, 1, "0xid")).toThrow(NotaHashError);
  });

  it("throws NotaHashError for empty identifier", () => {
    expect(() => computeResourceIdHash(0, 1, "")).toThrow(NotaHashError);
  });

  it("is deterministic for the same inputs", () => {
    const h1 = computeResourceIdHash(2, 137, "0xcontract");
    const h2 = computeResourceIdHash(2, 137, "0xcontract");
    expect(h1).toBe(h2);
  });
});
