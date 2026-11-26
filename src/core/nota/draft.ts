/**
 * Composing content before it is signed and minted
 * (protocol/v1.1/10-conformance-gate.md "Mint Flow", step 1).
 *
 * Until the mint transaction is final the content is a draft. A draft is not
 * a `.nota` file and MUST NOT be written with the `.nota` extension.
 */

import { getAddress } from "ethers";
import { NOTA_SCHEMA_VERSION, NOTA_ZERO_HASH } from "../constants.js";
import { validateContent } from "./conformance.js";
import type { NotaContent, NotaDraft } from "./content.js";
import { computeMetadataHash, encodeMetadata } from "./metadata.js";

/** What an issuer supplies to compose a draft. Members left out take their empty value. */
export interface NotaDraftInput {
  /** Resource type name, e.g. `"address"`. */
  type: string;
  chain: {
    name: string;
    /** EIP-155 chain ID. 0 for chains without one. */
    chainId: number;
    /** Defaults to `"mainnet"`. */
    network?: string;
  };
  resource: {
    identifier: string;
    name?: string;
    alias?: string;
    description?: string;
  };
  issuer: {
    /** The account that will sign. Any letter case; written as EIP-55. */
    account: string;
    name?: string;
    entityType?: "" | "individual" | "organization";
  };
  /** Type-specific metadata. Everything in it is published on-chain permanently. */
  metadata?: Record<string, unknown> | null;
  /** `notaId` of the file this one replaces. Defaults to the zero hash. */
  supersedes?: string;
  /** Unix seconds. Defaults to the current time. */
  issuedAt?: number;
  /** Unix seconds. Defaults to 0, no expiry. */
  expiresAt?: number;
}

/**
 * Normalizes every string in a JSON-like value to Unicode NFC, including
 * object member names. Returns a new value; the input is not modified.
 */
export function normalizeNfc<T>(value: T): T {
  if (typeof value === "string") return value.normalize("NFC") as unknown as T;
  if (Array.isArray(value)) return value.map((item) => normalizeNfc(item)) as unknown as T;
  if (typeof value === "object" && value !== null) {
    // Object.fromEntries defines own properties, so a member named "__proto__"
    // (which JSON.parse can produce) stays a member instead of becoming the prototype.
    return Object.fromEntries(
      Object.entries(value).map(([name, member]) => [name.normalize("NFC"), normalizeNfc(member)])
    ) as T;
  }
  return value;
}

/** Builds the content layer from draft input without validating it. */
export function assembleDraft(
  input: NotaDraftInput,
  now: number = Math.floor(Date.now() / 1000)
): { content: NotaContent; metadata: Record<string, unknown> | null } {
  const text = (value: string | undefined): string => (value ?? "").normalize("NFC");
  let account = input.issuer.account;
  try {
    // Writes the EIP-55 spelling. A mixed-case address with a bad checksum is
    // left as given, and the validator refuses it.
    account = getAddress(account);
  } catch {
    /* reported by validateContent */
  }
  const metadata =
    input.metadata === undefined || input.metadata === null ? null : normalizeNfc(input.metadata);
  const content: NotaContent = {
    version: NOTA_SCHEMA_VERSION,
    type: input.type,
    chain: {
      name: input.chain.name,
      chainId: input.chain.chainId,
      network: input.chain.network ?? "mainnet",
    },
    resource: {
      identifier: input.resource.identifier,
      name: text(input.resource.name),
      alias: input.resource.alias ?? "",
      description: text(input.resource.description),
    },
    issuer: {
      account,
      name: text(input.issuer.name),
      entityType: input.issuer.entityType ?? "",
    },
    metadataHash: NOTA_ZERO_HASH,
    supersedes: input.supersedes ?? NOTA_ZERO_HASH,
    issuedAt: input.issuedAt ?? now,
    expiresAt: input.expiresAt ?? 0,
  };
  return { content, metadata };
}

/**
 * Composes a draft: fills empty values, normalizes strings to Unicode NFC,
 * serializes the metadata canonically, sets `metadataHash`, and validates the
 * result against every locally decidable gate rule. Run the gate's `check()`
 * as a preflight, then sign with `signNotaContent`.
 *
 * @throws NotaConformanceError if the gate would refuse the content or metadata.
 */
export function composeNotaDraft(input: NotaDraftInput): NotaDraft {
  const { content, metadata } = assembleDraft(input);
  const metadataBytes = metadata === null ? null : encodeMetadata(metadata);
  content.metadataHash = computeMetadataHash(metadataBytes);
  validateContent(content, { requireNfc: true });
  return { content, metadata: metadataBytes };
}
