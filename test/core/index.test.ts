/**
 * The public surface of @notareum/core.
 */

import { describe, it, expect } from "vitest";
import * as core from "../../src/core/index.js";
import * as container from "../../src/core/container/index.js";
import * as crypto from "../../src/core/crypto/index.js";
import * as json from "../../src/core/json/index.js";
import * as legacy from "../../src/core/legacy/index.js";
import * as nota from "../../src/core/nota/index.js";
import { loadExample } from "./fixtures.js";

describe("constants", () => {
  it("describe the v1.1 format", () => {
    expect(core.NOTA_SCHEMA_VERSION).toBe("1.1");
    expect(core.NOTA_MIME_TYPE).toBe("application/vnd.notareum.nota");
    expect(core.NOTA_FILE_EXTENSION).toBe(".nota");
    expect(core.NOTA_APPLE_UTI).toBe("com.notareum.nota");
    expect(core.NOTA_MAGIC).toEqual([0x89, 0x4e, 0x4f, 0x54, 0x41, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect([core.NOTA_CONTAINER_VERSION_MAJOR, core.NOTA_CONTAINER_VERSION_MINOR]).toEqual([1, 1]);
    expect([core.NOTA_HEADER_BYTES, core.NOTA_TRAILER_BYTES, core.NOTA_OBJECT_OVERHEAD_BYTES]).toEqual([16, 64, 16]);
    expect(core.NOTA_EOF_MARK).toBe("NOTAEOF\n");
    expect(core.NOTA_EOF_MARK).toHaveLength(8);
  });

  it("carry the size limits", () => {
    expect(core.NOTA_MAX_FILE_BYTES).toBe(65_536);
    expect(core.NOTA_MAX_CONTENT_BYTES).toBe(4_096);
    expect(core.NOTA_MAX_METADATA_BYTES).toBe(32_768);
    expect(core.NOTA_MAX_JSON_DEPTH).toBe(8);
    expect(core.NOTA_FIELD_BYTE_LIMITS).toEqual({
      type: 32,
      "chain.name": 32,
      "chain.network": 16,
      "resource.identifier": 256,
      "resource.name": 64,
      "resource.alias": 68,
      "resource.description": 512,
      "issuer.name": 64,
    });
    expect(core.NOTA_MAX_INTEGER).toBe(2 ** 53 - 1);
  });

  it("carry the EIP-712 domain and ruleset 1 parameters", () => {
    expect([core.NOTA_EIP712_DOMAIN_NAME, core.NOTA_EIP712_DOMAIN_VERSION]).toEqual(["Notareum", "1.1"]);
    expect(core.NOTA_ZERO_HASH).toBe("0x" + "0".repeat(64));
    expect(core.NOTA_RULESET).toBe(1);
    expect(core.MINT_WINDOW_SECONDS).toBe(86_400);
    expect(core.MAX_CLOCK_SKEW_SECONDS).toBe(900);
  });

  it("name the legacy values as legacy", () => {
    expect(core.NOTA_LEGACY_SCHEMA_VERSION).toBe("1.0");
    expect(core.NOTA_LEGACY_MIME_TYPE).toBe("application/vnd.notareum.nota+json");
    expect(core.NOTA_LEGACY_SIGNATURE_PREFIX).toBe("Notareum v1.0 | ");
    expect(core).not.toHaveProperty("NOTA_SIGNATURE_PREFIX");
  });
});

describe("exports", () => {
  it("expose the v1.1 API from the package root", () => {
    for (const name of [
      // files
      "readNota",
      "writeNota",
      "appendAnnex",
      "collapseAnnexes",
      "extractMintedBody",
      "reconstructFromMintEvent",
      "contentFromMintedStruct",
      "NOTA_MINTED_EVENT_ABI",
      // container
      "readContainer",
      "hasNotaMagic",
      "encodeHeader",
      "encodeObject",
      "encodeXrefPayload",
      "encodeTrailer",
      "appendRevision",
      "crc32",
      // canonical JSON
      "canonicalize",
      "canonicalBytes",
      "parseCanonicalJson",
      "isCanonicalJson",
      // crypto
      "NOTA_EIP712_TYPES",
      "NOTA_EIP712_TYPE_HASH",
      "notaDomain",
      "computeNotaId",
      "hashNotaStruct",
      "signNotaContent",
      "recoverNotaSigner",
      "verifyNotaSignature",
      // metadata
      "computeMetadataHash",
      "encodeMetadata",
      "validateMetadataBytes",
      "scanMetadataStructure",
      // validation
      "checkContent",
      "validateContent",
      "isConformingContent",
      "checkIdentifier",
      "checkAlias",
      "checkDisplayString",
      "classifyCodePoint",
      "findTextSafetyViolation",
      "findUtf8SafetyViolation",
      // payloads
      "buildReceipt",
      "buildStatusSnapshot",
      "buildSignature",
      "validateReceipt",
      "validateStatusSnapshot",
      "validateSignature",
      "computeNotaResourceId",
      "deriveControlProof",
      // drafts
      "composeNotaDraft",
      // errors
      "NotaContainerError",
      "NotaConformanceError",
      "CanonicalJsonError",
    ]) {
      expect(core, name).toHaveProperty(name);
      expect((core as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  it("define no SOCL object type: annexes carry STAT only", () => {
    expect(Object.keys(core.NOTA_OBJECT_TYPES)).toEqual(["CONT", "META", "SIGN", "RCPT", "STAT", "XREF"]);
    expect(core.NOTA_JSON_OBJECT_TYPES).toEqual(["CONT", "META", "SIGN", "RCPT", "STAT"]);
    for (const name of ["buildSocialSnapshot", "validateSocialSnapshot"]) {
      expect(core, name).not.toHaveProperty(name);
    }
  });

  it("keep the v1.0 JSON API under clearly legacy names only", () => {
    // The v1.0 names no longer exist at the root, where they would be
    // mistaken for the v1.1 API.
    for (const name of ["parseNota", "serializeNota", "buildNota", "validateNota", "signNota", "buildSigningMessage"]) {
      expect(core, name).not.toHaveProperty(name);
      expect(core.legacy, name).toHaveProperty(name);
    }
    expect(core.parseLegacyNota).toBe(legacy.parseNota);
    expect(core.importLegacyNota).toBe(legacy.importLegacyNota);
    expect(core.isLegacyNotaDocument).toBe(legacy.isLegacyNotaDocument);
  });

  it("offer the same functions through the entry points", () => {
    expect(core.readNota).toBe(nota.readNota);
    expect(core.readContainer).toBe(container.readContainer);
    expect(core.canonicalize).toBe(json.canonicalize);
    expect(core.computeNotaId).toBe(crypto.computeNotaId);
  });

  it("still export the registry, verification and staking modules", () => {
    for (const name of [
      "ResourceType",
      "NotaStatus",
      "VerificationLevel",
      "registerResourceType",
      "computeResourceId",
      "computeResourceIdHash",
      "QUORUM_CONFIGS",
      "resolveQuorum",
      "StakingTier",
      "computeStakingTier",
    ]) {
      expect(core, name).toHaveProperty(name);
    }
    expect(core.NotaStatus.REGISTERED).toBe(0);
    expect(core.NotaStatus.SUPERSEDED).toBe(5);
    expect(core.NOTA_STATUS_STRINGS[core.NotaStatus.VERIFIED]).toBe("verified");
  });

  it("read a file end to end from the root export", () => {
    const nota = core.readNota(loadExample("address-verified.nota"));
    expect(nota.notaId).toBe("0x74820ee3bb5ccaf696c2792f648c4e4c931ea37415a3956c381592e00e42da95");
    expect(nota.statusSnapshot?.status).toBe("verified");
  });
});
