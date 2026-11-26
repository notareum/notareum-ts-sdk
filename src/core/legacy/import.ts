/**
 * Importing a legacy v1.0 JSON document as a v1.1 draft
 * (protocol/v1.1/01-nota-format.md "Legacy v1.0 Documents").
 *
 * A file whose first byte is `{` is a v1.0 JSON document, not a v1.1 file.
 * It can be imported as a draft: its fields are mapped onto the v1.1 content
 * layer, the issuer signs, and the draft is minted. Its embedded
 * `verification` block, its signature and `issuer.verified` are discarded: a
 * v1.0 document MUST NOT be presented as registered or verified on their
 * strength.
 */

import { getAddress } from "ethers";
import { CanonicalJsonError, NotaConformanceError, NotaParseError } from "../errors.js";
import { canonicalBytes } from "../json/canonical.js";
import { checkContent, isPlainObject } from "../nota/conformance.js";
import type { ConformanceIssue } from "../nota/conformance.js";
import type { NotaDraft } from "../nota/content.js";
import { assembleDraft } from "../nota/draft.js";
import { computeMetadataHash, validateMetadataBytes } from "../nota/metadata.js";
import { Utf8Error, decodeUtf8 } from "../utf8.js";
import { parseNota } from "./parser.js";
import type { NotaFile as LegacyNotaFile } from "./types.js";

/** True when the input starts with `{`: a v1.0 JSON document rather than a v1.1 container. */
export function isLegacyNotaDocument(input: Uint8Array | string): boolean {
  if (typeof input === "string") return input.charCodeAt(0) === 0x7b;
  return input.length > 0 && input[0] === 0x7b;
}

/** The result of importing a v1.0 document. */
export interface LegacyImport {
  /** The v1.0 document as parsed. */
  document: LegacyNotaFile;
  /** The v1.1 draft. Not signed, not minted, and not a `.nota` file. */
  draft: NotaDraft;
  /**
   * Everything that stops the draft from being minted as it stands. Empty
   * when the draft conforms. v1.0 accepted content that v1.1 refuses, so a
   * non-empty list is expected for some documents.
   */
  issues: ConformanceIssue[];
  /** Changes made to values while mapping, for display to the issuer. */
  notes: string[];
}

export interface LegacyImportOptions {
  /** `issuedAt` of the draft, in Unix seconds. Defaults to the current time. */
  issuedAt?: number;
}

/**
 * Imports a v1.0 `.nota` JSON document as a v1.1 draft.
 *
 * Mapping: `resource.metadata` becomes the `META` payload, bound by
 * `metadataHash`; `issuer.address` (or, failing that, the v1.0 signer)
 * becomes `issuer.account`; members v1.0 allowed to be omitted take their
 * empty values; `supersedes` and `expiresAt` are empty. The v1.0
 * `verification` block, `signature` and `issuer.verified` are dropped.
 *
 * @throws NotaParseError if the input is not a v1.0 JSON document.
 */
export function importLegacyNota(
  input: string | Uint8Array,
  options: LegacyImportOptions = {}
): LegacyImport {
  let text: string;
  if (typeof input === "string") {
    text = input;
  } else {
    try {
      text = decodeUtf8(input);
    } catch (err) {
      if (err instanceof Utf8Error) throw new NotaParseError(`Invalid UTF-8: ${err.message}`);
      throw err;
    }
  }
  if (!isLegacyNotaDocument(text)) {
    throw new NotaParseError("Not a v1.0 JSON document: the first byte is not '{'.");
  }
  const document = parseNota(text);
  const notes: string[] = [];
  const str = (value: unknown): string => (typeof value === "string" ? value : "");
  const chain: Record<string, unknown> = isPlainObject(document.chain) ? document.chain : {};
  const resource: Record<string, unknown> = isPlainObject(document.resource) ? document.resource : {};
  const issuer: Record<string, unknown> = isPlainObject(document.issuer) ? document.issuer : {};
  const legacySignature: Record<string, unknown> = isPlainObject(document.signature)
    ? document.signature
    : {};

  const type = str(document.type);
  const chainId = typeof chain.chainId === "number" ? chain.chainId : 0;

  // v1.1 fixes one spelling per identifier.
  let identifier = str(resource.identifier);
  if (type === "ipfs" && identifier.startsWith("ipfs://")) {
    identifier = identifier.slice("ipfs://".length);
    notes.push("resource.identifier: removed the ipfs:// prefix, which v1.1 does not permit");
  }
  if ((type === "address" || type === "contract") && chainId > 0 && /^0x[0-9a-fA-F]{40}$/.test(identifier)) {
    try {
      const checksummed = getAddress(identifier);
      if (checksummed !== identifier) {
        identifier = checksummed;
        notes.push("resource.identifier: rewritten with its EIP-55 checksum");
      }
    } catch {
      /* a mixed-case address with a bad checksum is reported as an issue */
    }
  }

  const account = str(issuer.address) || str(legacySignature.address);
  if (str(issuer.address) === "" && account !== "") {
    notes.push("issuer.account: taken from the v1.0 signature, since the document named no issuer");
  }
  const entityType = issuer.entityType === "individual" || issuer.entityType === "organization"
    ? issuer.entityType
    : "";

  const legacyMetadata =
    isPlainObject(resource.metadata) && Object.keys(resource.metadata).length > 0
      ? resource.metadata
      : null;

  const { content, metadata } = assembleDraft(
    {
      type,
      chain: {
        name: str(chain.name),
        chainId,
        network: str(chain.network) || "mainnet",
      },
      resource: {
        identifier,
        name: str(resource.name),
        alias: str(resource.alias),
        description: str(resource.description),
      },
      issuer: { account, name: str(issuer.name), entityType },
      metadata: legacyMetadata,
    },
    options.issuedAt
  );

  const issues: ConformanceIssue[] = [];
  let metadataBytes: Uint8Array | null = null;
  if (metadata !== null) {
    try {
      metadataBytes = canonicalBytes(metadata);
    } catch (err) {
      if (!(err instanceof CanonicalJsonError)) throw err;
      issues.push({ rule: "SCHEMA", field: "metadata", message: err.message });
    }
    if (metadataBytes !== null) {
      try {
        validateMetadataBytes(metadataBytes);
      } catch (err) {
        if (!(err instanceof NotaConformanceError)) throw err;
        issues.push({ rule: err.rule, field: "metadata", message: err.message });
      }
    }
  }
  content.metadataHash = computeMetadataHash(metadataBytes);
  issues.push(...checkContent(content, { requireNfc: true }));

  if (document.verification !== undefined) {
    notes.push("verification: dropped; status lives in the registry and is not carried over");
  }
  notes.push("signature: dropped; the issuer signs the v1.1 content as EIP-712 typed data");

  return { document, draft: { content, metadata: metadataBytes }, issues, notes };
}
