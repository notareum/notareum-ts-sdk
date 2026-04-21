import { describe, it, expect } from "vitest";
import { parseNota, serializeNota } from "../../../src/core/nota/parser.js";
import { NotaParseError } from "../../../src/core/errors.js";
import type { NotaFile } from "../../../src/core/nota/types.js";

const validNotaJson: NotaFile = {
  version: "1.0",
  type: "address",
  chain: { name: "ethereum", chainId: 1, network: "mainnet" },
  resource: { identifier: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
  signature: {
    algorithm: "ECDSA",
    curve: "secp256k1",
    address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    message: "Notareum v1.0 | address:1:0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    signature: "0x" + "a".repeat(130),
    timestamp: 1700000000,
  },
};

describe("parseNota", () => {
  it("parses a valid .nota JSON string", () => {
    const result = parseNota(JSON.stringify(validNotaJson));
    expect(result.version).toBe("1.0");
    expect(result.type).toBe("address");
    expect(result.chain.chainId).toBe(1);
    expect(result.resource.identifier).toBe(
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
    );
  });

  it("throws NotaParseError for invalid JSON", () => {
    expect(() => parseNota("not json")).toThrow(NotaParseError);
    expect(() => parseNota("{bad json")).toThrow(NotaParseError);
  });

  it("throws NotaParseError for non-object root", () => {
    expect(() => parseNota('"string"')).toThrow(NotaParseError);
    expect(() => parseNota("[1,2,3]")).toThrow(NotaParseError);
    expect(() => parseNota("null")).toThrow(NotaParseError);
  });

  it("throws NotaParseError for missing required fields", () => {
    const missing = { ...validNotaJson };
    // Remove version
    const { version: _v, ...noVersion } = missing;
    expect(() => parseNota(JSON.stringify(noVersion))).toThrow(NotaParseError);
  });

  it("throws NotaParseError for missing 'type' field", () => {
    const { type: _t, ...noType } = validNotaJson;
    expect(() => parseNota(JSON.stringify(noType))).toThrow(NotaParseError);
  });

  it("throws NotaParseError for missing 'chain' field", () => {
    const { chain: _c, ...noChain } = validNotaJson;
    expect(() => parseNota(JSON.stringify(noChain))).toThrow(NotaParseError);
  });

  it("throws NotaParseError for missing 'resource' field", () => {
    const { resource: _r, ...noResource } = validNotaJson;
    expect(() => parseNota(JSON.stringify(noResource))).toThrow(NotaParseError);
  });

  it("throws NotaParseError for missing 'signature' field", () => {
    const { signature: _s, ...noSig } = validNotaJson;
    expect(() => parseNota(JSON.stringify(noSig))).toThrow(NotaParseError);
  });

  it("parses all resource types", () => {
    const types = [
      "address", "transaction", "contract", "ipfs", "nft", "metadata",
    ] as const;
    for (const t of types) {
      const n = { ...validNotaJson, type: t };
      const result = parseNota(JSON.stringify(n));
      expect(result.type).toBe(t);
    }
  });
});

describe("serializeNota", () => {
  it("produces valid JSON that round-trips", () => {
    const serialized = serializeNota(validNotaJson);
    expect(() => JSON.parse(serialized)).not.toThrow();
    const parsed = JSON.parse(serialized) as NotaFile;
    expect(parsed.version).toBe("1.0");
    expect(parsed.type).toBe("address");
  });

  it("sorts keys alphabetically at each level", () => {
    const serialized = serializeNota(validNotaJson);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    expect(keys).toEqual([...keys].sort());
  });

  it("is indented with 2 spaces", () => {
    const serialized = serializeNota(validNotaJson);
    expect(serialized).toContain("\n  ");
  });
});
