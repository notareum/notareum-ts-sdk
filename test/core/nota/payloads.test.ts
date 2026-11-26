/**
 * Builders and validators for the RCPT, STAT and SIGN payloads.
 */

import { describe, it, expect } from "vitest";
import { NotaConformanceError } from "../../../src/core/errors.js";
import {
  NotaStatus,
  VerificationLevel,
  buildReceipt,
  buildSignature,
  buildStatusSnapshot,
  computeNotaResourceId,
  controlProofName,
  registerResourceType,
  validateReceipt,
  validateStatusSnapshot,
} from "../../../src/core/nota/index.js";
import { computeResourceId } from "../../../src/core/registry/resource-id.js";
import {
  EXAMPLE_MINT,
  EXAMPLE_NOTA_ID,
  EXAMPLE_RESOURCE_ID,
  ISSUER,
  REGISTRY,
  exampleContent,
  exampleReceipt,
  exampleStatus,
  plainContent,
} from "../fixtures.js";

const TX = "0x" + "cd".repeat(32);

describe("buildReceipt", () => {
  it("builds the example receipt", () => {
    const receipt = buildReceipt({
      registry: REGISTRY,
      notaId: EXAMPLE_NOTA_ID,
      resourceId: EXAMPLE_RESOURCE_ID,
      ...EXAMPLE_MINT,
    });
    expect(receipt).toEqual(exampleReceipt());
  });

  it("accepts values as ethers decodes them: bigints, enum numbers, any hex case", () => {
    const receipt = buildReceipt({
      registry: REGISTRY,
      notaId: "0x" + EXAMPLE_NOTA_ID.slice(2).toUpperCase(),
      resourceId: EXAMPLE_RESOURCE_ID,
      ruleset: 1n,
      controlProof: 1n,
      transactionHash: "0x" + "AB".repeat(32),
      blockNumber: 7654321n,
      logIndex: 4n,
      mintedAt: 1795564812n,
    });
    expect(receipt).toEqual(exampleReceipt());
  });

  it("maps the ControlProof enum: 0 is CLAIMED, 1 is SELF", () => {
    expect(controlProofName(0)).toBe("claimed");
    expect(controlProofName(1)).toBe("self");
    expect(controlProofName(0n)).toBe("claimed");
    expect(controlProofName("self")).toBe("self");
    expect(() => controlProofName(2)).toThrow(NotaConformanceError);
    expect(() => controlProofName("SELF" as never)).toThrow(NotaConformanceError);
  });

  it("refuses values a receipt cannot hold", () => {
    const base = { registry: REGISTRY, notaId: EXAMPLE_NOTA_ID, resourceId: EXAMPLE_RESOURCE_ID, ...EXAMPLE_MINT };
    expect(() => buildReceipt({ ...base, blockNumber: 2n ** 53n })).toThrow(NotaConformanceError);
    expect(() => buildReceipt({ ...base, blockNumber: -1 })).toThrow(NotaConformanceError);
    expect(() => buildReceipt({ ...base, logIndex: 1.5 })).toThrow(NotaConformanceError);
    expect(() => buildReceipt({ ...base, ruleset: 65_536 })).toThrow(NotaConformanceError);
    expect(() => buildReceipt({ ...base, notaId: "0x1234" })).toThrow(NotaConformanceError);
    expect(() => buildReceipt({ ...base, transactionHash: "not hex" })).toThrow(NotaConformanceError);
    expect(() => buildReceipt({ ...base, registry: { chainId: 0, address: REGISTRY.address } })).toThrow(NotaConformanceError);
    expect(() => buildReceipt({ ...base, registry: { chainId: 1, address: ISSUER.toLowerCase() } })).toThrow(NotaConformanceError);
  });

  it("validateReceipt is exact about members", () => {
    expect(validateReceipt(exampleReceipt())).toEqual(exampleReceipt());
    expect(() => validateReceipt({ ...exampleReceipt(), status: "verified" })).toThrow(/not a defined member/);
    const { logIndex: _dropped, ...missing } = exampleReceipt();
    expect(() => validateReceipt(missing)).toThrow(/RCPT\.logIndex/);
    expect(() => validateReceipt(null)).toThrow(NotaConformanceError);
    expect(() => validateReceipt([])).toThrow(NotaConformanceError);
  });
});

describe("computeNotaResourceId", () => {
  it("matches the registry formula for the example", () => {
    expect(computeNotaResourceId(exampleContent())).toBe(EXAMPLE_RESOURCE_ID);
    expect(computeNotaResourceId(exampleContent())).toBe(computeResourceId(0, 1, ISSUER));
  });

  it("depends on type, chainId and identifier, and on nothing else", () => {
    const base = computeNotaResourceId(plainContent());
    expect(computeNotaResourceId(plainContent({ type: "contract" }))).not.toBe(base);
    expect(computeNotaResourceId(plainContent({ chain: { name: "ethereum", chainId: 5, network: "mainnet" } }))).not.toBe(base);
    const renamed = plainContent();
    renamed.resource.name = "Another name";
    renamed.issuer.name = "Another issuer";
    renamed.chain.name = "mainnet-alias";
    expect(computeNotaResourceId(renamed)).toBe(base);
  });

  it("supports governance-added type IDs above 5", () => {
    registerResourceType(42, "validator-key");
    const content = plainContent({ type: "validator-key" });
    content.resource.identifier = "key-1";
    expect(computeNotaResourceId(content)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(computeNotaResourceId(content)).not.toBe(computeNotaResourceId({ ...content, type: "address" }));
  });

  it("refuses an unregistered type", () => {
    expect(() => computeNotaResourceId(plainContent({ type: "unheard-of" }))).toThrow(NotaConformanceError);
  });
});

describe("buildStatusSnapshot", () => {
  it("builds the example STAT payload", () => {
    const snapshot = buildStatusSnapshot({
      asOfBlock: 7660000,
      asOfTime: 1795650000,
      status: "verified",
      request: { level: "basic", requestId: 42, approvals: 3, rejections: 0, transactionHash: TX },
    });
    expect(snapshot).toEqual(exampleStatus());
  });

  it("accepts registry enum values and bigints", () => {
    const snapshot = buildStatusSnapshot({
      asOfBlock: 7660000n,
      asOfTime: 1795650000n,
      status: NotaStatus.VERIFIED,
      request: {
        level: VerificationLevel.BASIC,
        requestId: 42n,
        approvals: 3n,
        rejections: 0n,
        transactionHash: "0x" + "CD".repeat(32),
      },
    });
    expect(snapshot).toEqual(exampleStatus());
    expect(buildStatusSnapshot({ asOfBlock: 1, asOfTime: 2, status: NotaStatus.SUPERSEDED }).status).toBe("superseded");
    expect(buildStatusSnapshot({ asOfBlock: 1, asOfTime: 2, status: 0n }).status).toBe("registered");
  });

  it("writes empty values when there is no resolved request", () => {
    expect(buildStatusSnapshot({ asOfBlock: 7660000, asOfTime: 1795650000, status: "registered" })).toEqual({
      asOfBlock: 7660000,
      asOfTime: 1795650000,
      status: "registered",
      level: "",
      requestId: 0,
      approvals: 0,
      rejections: 0,
      transactionHash: "",
    });
  });

  it.each(["registered", "pending", "verified", "disputed", "revoked", "superseded"] as const)(
    "accepts status %s",
    (status) => {
      const request = { level: "enhanced" as const, requestId: 7, approvals: 6, rejections: 1, transactionHash: TX };
      expect(buildStatusSnapshot({ asOfBlock: 1, asOfTime: 1, status, request }).status).toBe(status);
    }
  );

  it("refuses unknown statuses and levels", () => {
    expect(() => buildStatusSnapshot({ asOfBlock: 1, asOfTime: 1, status: "unverified" as never })).toThrow(NotaConformanceError);
    expect(() => buildStatusSnapshot({ asOfBlock: 1, asOfTime: 1, status: 6 })).toThrow(NotaConformanceError);
    expect(() =>
      buildStatusSnapshot({
        asOfBlock: 1,
        asOfTime: 1,
        status: "verified",
        request: { level: "premium" as never, requestId: 1, approvals: 3, rejections: 0, transactionHash: TX },
      })
    ).toThrow(NotaConformanceError);
  });

  it("validateStatusSnapshot refuses inconsistent snapshots", () => {
    const s = exampleStatus();
    expect(validateStatusSnapshot(s)).toEqual(s);
    // A verified status with no request behind it.
    expect(() => validateStatusSnapshot({ ...s, level: "", transactionHash: "", requestId: 0, approvals: 0, rejections: 0 })).toThrow(/verified/);
    // Half a request.
    expect(() => validateStatusSnapshot({ ...s, level: "" })).toThrow(NotaConformanceError);
    expect(() => validateStatusSnapshot({ ...s, transactionHash: "" })).toThrow(NotaConformanceError);
    expect(() => validateStatusSnapshot({ ...s, status: "registered", level: "", transactionHash: "", requestId: 0, approvals: 2, rejections: 0 })).toThrow(NotaConformanceError);
    // Schema.
    expect(() => validateStatusSnapshot({ ...s, validators: [] })).toThrow(/not a defined member/);
    expect(() => validateStatusSnapshot({ ...s, approvals: "3" })).toThrow(NotaConformanceError);
    expect(() => validateStatusSnapshot({ ...s, transactionHash: "0xCD" })).toThrow(NotaConformanceError);
    const { rejections: _dropped, ...missing } = s;
    expect(() => validateStatusSnapshot(missing)).toThrow(/STAT\.rejections/);
  });
});

describe("buildSignature", () => {
  const sig65 = "0x" + "11".repeat(32) + "22".repeat(32) + "1b";

  it("derives the scheme from whether the issuer has code", () => {
    expect(buildSignature({ signature: sig65, signer: ISSUER, signerHasCode: false }).scheme).toBe("eip712-secp256k1");
    expect(buildSignature({ signature: "0x" + "ab".repeat(100), signer: ISSUER, signerHasCode: true }).scheme).toBe("erc1271");
    expect(() => buildSignature({ signature: sig65, signer: ISSUER })).toThrow(NotaConformanceError);
  });

  it("lowercases hex and accepts raw bytes", () => {
    const upper = "0x" + sig65.slice(2).toUpperCase();
    expect(buildSignature({ signature: upper, signer: ISSUER, scheme: "eip712-secp256k1" }).signature).toBe(sig65);
    const bytes = Uint8Array.from(Buffer.from(sig65.slice(2), "hex"));
    expect(buildSignature({ signature: bytes, signer: ISSUER, scheme: "eip712-secp256k1" }).signature).toBe(sig65);
  });

  it("refuses an ECDSA signature the gate would refuse", () => {
    const highS = "0x" + "11".repeat(32) + "ff".repeat(32) + "1b";
    expect(() => buildSignature({ signature: highS, signer: ISSUER, scheme: "eip712-secp256k1" })).toThrow(/G9/);
    expect(() => buildSignature({ signature: "0x" + "11".repeat(64), signer: ISSUER, scheme: "eip712-secp256k1" })).toThrow(/G9/);
    expect(() => buildSignature({ signature: sig65, signer: ISSUER.toLowerCase(), scheme: "eip712-secp256k1" })).toThrow(NotaConformanceError);
  });
});
