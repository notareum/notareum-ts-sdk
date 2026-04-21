import { describe, it, expect } from "vitest";
import { validateNota, isValidNota } from "../../../src/core/nota/validator.js";
import { NotaValidationError } from "../../../src/core/errors.js";
import type { NotaFile } from "../../../src/core/nota/types.js";

function makeValidNota(): NotaFile {
  return {
    version: "1.0",
    type: "address",
    chain: { name: "ethereum", chainId: 1 },
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
}

describe("validateNota", () => {
  it("accepts a valid nota file", () => {
    expect(() => validateNota(makeValidNota())).not.toThrow();
  });

  it("rejects unsupported schema version", () => {
    const nota = makeValidNota();
    nota.version = "2.0";
    expect(() => validateNota(nota)).toThrow(NotaValidationError);
  });

  it("rejects invalid resource type", () => {
    const nota = makeValidNota();
    (nota as unknown as Record<string, unknown>).type = "invalid_type";
    expect(() => validateNota(nota)).toThrow(NotaValidationError);
  });

  it("accepts all valid resource types", () => {
    const types = [
      "address", "transaction", "contract", "ipfs", "nft", "metadata",
    ] as const;
    for (const t of types) {
      const nota = { ...makeValidNota(), type: t };
      expect(() => validateNota(nota)).not.toThrow();
    }
  });

  it("rejects missing chain", () => {
    const nota = makeValidNota();
    (nota as unknown as Record<string, unknown>).chain = null;
    expect(() => validateNota(nota)).toThrow(NotaValidationError);
  });

  it("rejects empty chain name", () => {
    const nota = makeValidNota();
    nota.chain.name = "";
    expect(() => validateNota(nota)).toThrow(NotaValidationError);
  });

  it("rejects negative chainId", () => {
    const nota = makeValidNota();
    nota.chain.chainId = -1;
    expect(() => validateNota(nota)).toThrow(NotaValidationError);
  });

  it("rejects non-integer chainId", () => {
    const nota = makeValidNota();
    nota.chain.chainId = 1.5;
    expect(() => validateNota(nota)).toThrow(NotaValidationError);
  });

  it("rejects empty resource identifier", () => {
    const nota = makeValidNota();
    nota.resource.identifier = "";
    expect(() => validateNota(nota)).toThrow(NotaValidationError);
  });

  it("rejects metadata exceeding 32KB", () => {
    const nota = makeValidNota();
    nota.resource.metadata = { data: "x".repeat(33 * 1024) };
    expect(() => validateNota(nota)).toThrow(NotaValidationError);
  });

  it("rejects invalid verification status", () => {
    const nota = makeValidNota();
    nota.verification = { status: "invalid" as "unverified" };
    expect(() => validateNota(nota)).toThrow(NotaValidationError);
  });

  it("rejects invalid verification level", () => {
    const nota = makeValidNota();
    nota.verification = { status: "pending", level: "ultra" as "basic" };
    expect(() => validateNota(nota)).toThrow(NotaValidationError);
  });

  it("accepts valid verification statuses", () => {
    const statuses = [
      "unverified", "pending", "verified", "disputed", "revoked",
    ] as const;
    for (const status of statuses) {
      const nota = { ...makeValidNota(), verification: { status } };
      expect(() => validateNota(nota)).not.toThrow();
    }
  });

  it("rejects invalid signature algorithm", () => {
    const nota = makeValidNota();
    (nota.signature as unknown as Record<string, unknown>).algorithm = "RSA";
    expect(() => validateNota(nota)).toThrow(NotaValidationError);
  });

  it("rejects invalid signature curve", () => {
    const nota = makeValidNota();
    (nota.signature as unknown as Record<string, unknown>).curve = "p256";
    expect(() => validateNota(nota)).toThrow(NotaValidationError);
  });

  it("rejects empty signing address", () => {
    const nota = makeValidNota();
    nota.signature.address = "";
    expect(() => validateNota(nota)).toThrow(NotaValidationError);
  });

  it("rejects zero/negative timestamp", () => {
    const nota = makeValidNota();
    nota.signature.timestamp = 0;
    expect(() => validateNota(nota)).toThrow(NotaValidationError);

    const nota2 = makeValidNota();
    nota2.signature.timestamp = -1;
    expect(() => validateNota(nota2)).toThrow(NotaValidationError);
  });
});

describe("isValidNota", () => {
  it("returns true for a valid nota", () => {
    expect(isValidNota(makeValidNota())).toBe(true);
  });

  it("returns false for an invalid nota", () => {
    const nota = makeValidNota();
    nota.version = "99.0";
    expect(isValidNota(nota)).toBe(false);
  });
});
