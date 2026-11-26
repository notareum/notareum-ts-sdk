/**
 * Importing a v1.0 JSON document as a v1.1 draft.
 */

import { describe, it, expect } from "vitest";
import { NotaContainerError, NotaParseError } from "../../../src/core/errors.js";
import { importLegacyNota, isLegacyNotaDocument } from "../../../src/core/legacy/index.js";
import type { NotaFile as LegacyNotaFile } from "../../../src/core/legacy/index.js";
import { checkContent, computeMetadataHash, readNota } from "../../../src/core/nota/index.js";
import { ISSUER, ZERO32, loadExample } from "../fixtures.js";

function legacyDocument(overrides: Partial<LegacyNotaFile> = {}): LegacyNotaFile {
  return {
    version: "1.0",
    type: "address",
    chain: { name: "ethereum", chainId: 1, network: "mainnet" },
    resource: {
      identifier: ISSUER,
      name: "Example Treasury",
      alias: "example-treasury.nota",
      metadata: { tags: ["treasury"], ens: "example.eth" },
    },
    verification: { status: "verified", level: "institutional", validators: [ISSUER] },
    signature: {
      algorithm: "ECDSA",
      curve: "secp256k1",
      address: ISSUER,
      message: `Notareum v1.0 | address:1:${ISSUER}`,
      signature: "0x" + "a".repeat(130),
      timestamp: 1700000000,
    },
    issuer: { address: ISSUER, name: "Example Labs", verified: true, entityType: "organization" },
    ...overrides,
  };
}

describe("isLegacyNotaDocument", () => {
  it("tells a v1.0 JSON document from a v1.1 container by the first byte", () => {
    expect(isLegacyNotaDocument(JSON.stringify(legacyDocument()))).toBe(true);
    expect(isLegacyNotaDocument(new TextEncoder().encode("{}"))).toBe(true);
    expect(isLegacyNotaDocument(loadExample("address-registered.nota"))).toBe(false);
    expect(isLegacyNotaDocument(new Uint8Array(0))).toBe(false);
    expect(isLegacyNotaDocument("")).toBe(false);
  });
});

describe("importLegacyNota", () => {
  it("maps a v1.0 document onto the v1.1 content layer", () => {
    const { draft, issues } = importLegacyNota(JSON.stringify(legacyDocument()), { issuedAt: 1795564800 });
    expect(issues).toEqual([]);
    expect(draft.content).toEqual({
      version: "1.1",
      type: "address",
      chain: { name: "ethereum", chainId: 1, network: "mainnet" },
      resource: { identifier: ISSUER, name: "Example Treasury", alias: "example-treasury.nota", description: "" },
      issuer: { account: ISSUER, name: "Example Labs", entityType: "organization" },
      metadataHash: computeMetadataHash(draft.metadata),
      supersedes: ZERO32,
      issuedAt: 1795564800,
      expiresAt: 0,
    });
    // resource.metadata moves to the META payload, bound by metadataHash.
    expect(new TextDecoder().decode(draft.metadata!)).toBe('{"ens":"example.eth","tags":["treasury"]}');
    expect(checkContent(draft.content)).toEqual([]);
  });

  it("discards the self-asserted verification block, signature and issuer.verified", () => {
    const { draft, notes } = importLegacyNota(JSON.stringify(legacyDocument()));
    const text = JSON.stringify(draft.content);
    expect(text).not.toContain("verified");
    expect(text).not.toContain("institutional");
    expect(text).not.toContain("signature");
    expect(notes.some((n) => n.startsWith("verification: dropped"))).toBe(true);
    expect(notes.some((n) => n.startsWith("signature: dropped"))).toBe(true);
  });

  it("accepts bytes as well as text", () => {
    const bytes = new TextEncoder().encode(JSON.stringify(legacyDocument()));
    expect(importLegacyNota(bytes).draft.content.type).toBe("address");
  });

  it("fills empty values for members v1.0 allowed to be omitted", () => {
    const minimal = legacyDocument({
      chain: { name: "ethereum", chainId: 1 },
      resource: { identifier: ISSUER },
      issuer: undefined,
      verification: undefined,
    });
    const { draft, issues, notes } = importLegacyNota(JSON.stringify(minimal), { issuedAt: 1 });
    expect(issues).toEqual([]);
    expect(draft.metadata).toBeNull();
    expect(draft.content.metadataHash).toBe(ZERO32);
    expect(draft.content.chain.network).toBe("mainnet");
    expect(draft.content.resource).toEqual({ identifier: ISSUER, name: "", alias: "", description: "" });
    // With no issuer block, the v1.0 signer becomes the issuer account.
    expect(draft.content.issuer).toEqual({ account: ISSUER, name: "", entityType: "" });
    expect(notes.some((n) => n.startsWith("issuer.account"))).toBe(true);
  });

  it("rewrites identifiers to the one spelling v1.1 permits", () => {
    const lower = legacyDocument({ resource: { identifier: ISSUER.toLowerCase() } });
    const a = importLegacyNota(JSON.stringify(lower));
    expect(a.draft.content.resource.identifier).toBe(ISSUER);
    expect(a.issues).toEqual([]);

    const cid = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
    const ipfs = legacyDocument({ type: "ipfs", resource: { identifier: "ipfs://" + cid } });
    const b = importLegacyNota(JSON.stringify(ipfs));
    expect(b.draft.content.resource.identifier).toBe(cid);
    expect(b.issues).toEqual([]);
    expect(b.notes.some((n) => n.includes("ipfs://"))).toBe(true);
  });

  it("reports what stops a v1.0 document from being minted as it stands", () => {
    const doc = legacyDocument({
      resource: {
        identifier: ISSUER,
        name: "Visit https://example.com",
        alias: "Example",
        metadata: { note: "line one\nline two" },
      },
    });
    const { issues, draft } = importLegacyNota(JSON.stringify(doc));
    const found = issues.map((i) => `${i.rule} ${i.field}`);
    expect(found).toContain("G6 resource.name");
    expect(found).toContain("G5 resource.alias");
    expect(found.some((f) => f.endsWith("metadata"))).toBe(true);
    // The draft is returned for the issuer to correct. It is not a .nota file.
    expect(draft.content.resource.name).toBe("Visit https://example.com");
  });

  it("refuses input that is not a v1.0 JSON document", () => {
    expect(() => importLegacyNota(loadExample("address-registered.nota"))).toThrow(NotaParseError);
    expect(() => importLegacyNota("[]")).toThrow(NotaParseError);
    expect(() => importLegacyNota("{not json")).toThrow(NotaParseError);
    expect(() => importLegacyNota('{"version":"1.0"}')).toThrow(NotaParseError);
  });
});

describe("a v1.0 document is not a .nota file", () => {
  it("is refused by the v1.1 reader, which names it", () => {
    const bytes = new TextEncoder().encode(JSON.stringify(legacyDocument()));
    try {
      readNota(bytes);
      throw new Error("accepted");
    } catch (err) {
      expect(err).toBeInstanceOf(NotaContainerError);
      expect((err as NotaContainerError).code).toBe("LEGACY_DOCUMENT");
    }
  });
});
