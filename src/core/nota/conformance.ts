/**
 * Local validator for the content layer.
 *
 * Applies the rules of the Conformance Gate that can be decided from the
 * content alone (protocol/v1.1/10-conformance-gate.md): G1 envelope, G2 field
 * limits, G3 text safety (T1 through T6), G4 identifier grammar, G5 alias
 * grammar and G6 display strings, plus the content schema of
 * protocol/v1.1/01-nota-format.md. A reader runs it on every file, so that a
 * file with a fabricated receipt cannot deliver content the gate would have
 * refused; an SDK runs it before signing.
 *
 * Not decided here: G7 (metadata binding, see `metadata.ts`), G8 and G9 (see
 * `file.ts`, which checks them against the receipt and signature), and G10
 * through G13, which need registry state.
 */

import { getAddress } from "ethers";
import {
  NOTA_FIELD_BYTE_LIMITS,
  NOTA_MAX_NATIVE_IDENTIFIER_CHARS,
  NOTA_SCHEMA_VERSION,
} from "../constants.js";
import { NotaConformanceError } from "../errors.js";
import { utf8ByteLength } from "../utf8.js";
import type { NotaContent } from "./content.js";
import { findTextSafetyViolation } from "./safety.js";
import { isValidResourceType } from "./types.js";

/** One way in which content fails to conform. */
export interface ConformanceIssue {
  /**
   * `G1`, `G2`, `G4`, `G5`, `G6` (gate rules); `T1` to `T6` (Content Safety
   * Rules, which are gate rule G3); `SCHEMA` (a member is missing, unknown or
   * of the wrong JSON type); or `NFC`.
   */
  rule: string;
  /** Member path, e.g. `resource.name`. `$` for the content as a whole. */
  field: string;
  message: string;
}

export interface ContentCheckOptions {
  /**
   * Also require every string to be in Unicode NFC. The gate cannot check
   * normalization, so a reader must not refuse a file for it; an SDK checks
   * it before signing. Default false.
   */
  requireNfc?: boolean;
}

const NAME_RE = /^[a-z0-9-]{1,32}$/;
const NETWORKS: readonly string[] = ["mainnet", "testnet", "devnet"];
const ENTITY_TYPES: readonly string[] = ["", "individual", "organization"];
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_RE = /^0x[0-9a-f]{64}$/;
const ALIAS_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.nota$/;
const NFT_RE = /^(0x[0-9a-fA-F]{40})\/(0|[1-9][0-9]*)$/;
const CID_V0_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1_RE = /^b[a-z2-7]+$/;
const URI_RE = /^[a-z][a-z0-9+.-]*:[\x21-\x7e]+$/;
const PRINTABLE_RE = /^[\x21-\x7e]+$/;
const EMBEDDED_HEX_RE = /0[xX][0-9a-fA-F]{8}/;
const UINT256_MAX = (1n << 256n) - 1n;

const CONTENT_MEMBERS = [
  "version",
  "type",
  "chain",
  "resource",
  "issuer",
  "metadataHash",
  "supersedes",
  "issuedAt",
  "expiresAt",
] as const;
const CHAIN_MEMBERS = ["name", "chainId", "network"] as const;
const RESOURCE_MEMBERS = ["identifier", "name", "alias", "description"] as const;
const ISSUER_MEMBERS = ["account", "name", "entityType"] as const;

/** True for `0x` plus 40 hex digits carrying a valid EIP-55 checksum. */
export function isEip55Address(value: unknown): value is string {
  if (typeof value !== "string" || !ADDRESS_RE.test(value)) return false;
  try {
    return getAddress(value.toLowerCase()) === value;
  } catch {
    return false;
  }
}

/** True for `0x` plus 64 lowercase hex digits. */
export function isBytes32Hex(value: unknown): value is string {
  return typeof value === "string" && BYTES32_RE.test(value);
}

/** True for a plain JSON object (not an array, not null). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * G4: checks `resource.identifier` against the grammar for its type and
 * chain. Returns a description of the failure, or `null` if it conforms.
 */
export function checkIdentifier(type: string, chainId: number, identifier: string): string | null {
  switch (type) {
    case "address":
    case "contract":
      if (chainId === 0) return checkNativeIdentifier(identifier);
      return isEip55Address(identifier)
        ? null
        : "must be 0x and 40 hex digits with a valid EIP-55 checksum";
    case "transaction":
      if (chainId === 0) return checkNativeIdentifier(identifier);
      return BYTES32_RE.test(identifier) ? null : "must be 0x and 64 lowercase hex digits";
    case "nft": {
      if (chainId === 0) return checkNativeIdentifier(identifier);
      const match = NFT_RE.exec(identifier);
      if (match === null || !isEip55Address(match[1])) {
        return "must be an EIP-55 address, '/', and a decimal token ID with no leading zeros";
      }
      return BigInt(match[2]) <= UINT256_MAX ? null : "token ID exceeds 2^256 - 1";
    }
    case "ipfs":
      return CID_V0_RE.test(identifier) || CID_V1_RE.test(identifier)
        ? null
        : "must be a bare CID: CIDv0 (Qm and 44 base58btc characters) or CIDv1 in lowercase base32";
    case "metadata":
      return URI_RE.test(identifier)
        ? null
        : "must be a URI: a scheme matching [a-z][a-z0-9+.-]*, ':', and printable ASCII";
    default:
      // Governance-added types: printable ASCII, since ruleset 1 defines no grammar for them.
      return PRINTABLE_RE.test(identifier) ? null : "must be printable ASCII (U+0021 to U+007E)";
  }
}

function checkNativeIdentifier(identifier: string): string | null {
  return PRINTABLE_RE.test(identifier) && identifier.length <= NOTA_MAX_NATIVE_IDENTIFIER_CHARS
    ? null
    : `must be 1 to ${NOTA_MAX_NATIVE_IDENTIFIER_CHARS} printable ASCII characters (U+0021 to U+007E)`;
}

/** G5: an alias is empty or matches `[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.nota`. */
export function checkAlias(alias: string): string | null {
  return alias === "" || ALIAS_RE.test(alias)
    ? null
    : "must be empty or match [a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.nota";
}

/**
 * G6: display string rules for `resource.name`, `resource.description` and
 * `issuer.name`. Returns a description of the failure, or `null`.
 */
export function checkDisplayString(text: string): string | null {
  if (text.startsWith(" ") || text.endsWith(" ")) return "must not begin or end with a space";
  if (text.includes("  ")) return "must not contain two consecutive spaces";
  if (text.includes("://")) return "must not contain '://'";
  if (EMBEDDED_HEX_RE.test(text)) return "must not contain 0x followed by eight or more hex digits";
  return null;
}

/**
 * Checks content against the schema and the locally decidable gate rules,
 * and returns every issue found. An empty array means the content conforms.
 */
export function checkContent(content: unknown, options: ContentCheckOptions = {}): ConformanceIssue[] {
  const issues: ConformanceIssue[] = [];
  const add = (rule: string, field: string, message: string): void => {
    issues.push({ rule, field, message });
  };
  const requireNfc = options.requireNfc === true;

  /** Schema type, T1-T6, G2 byte limit and (optionally) NFC for one string member. */
  const checkString = (value: unknown, field: string): value is string => {
    if (typeof value !== "string") {
      add("SCHEMA", field, "must be a string");
      return false;
    }
    const violation = findTextSafetyViolation(value);
    if (violation !== null) add(violation.rule, field, violation.message);
    const limit = (NOTA_FIELD_BYTE_LIMITS as Record<string, number | undefined>)[field];
    if (limit !== undefined) {
      const bytes = utf8ByteLength(value);
      if (bytes > limit) add("G2", field, `is ${bytes} bytes; the limit is ${limit}`);
    }
    if (requireNfc && violation === null && value.normalize("NFC") !== value) {
      add("NFC", field, "is not in Unicode NFC");
    }
    return true;
  };
  const checkInteger = (value: unknown, field: string): value is number => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      add("SCHEMA", field, "must be a non-negative integer no greater than 2^53 - 1");
      return false;
    }
    return true;
  };
  const checkMembers = (
    value: unknown,
    members: readonly string[],
    field: string
  ): value is Record<string, unknown> => {
    if (!isPlainObject(value)) {
      add("SCHEMA", field, "must be a JSON object");
      return false;
    }
    const prefix = field === "$" ? "" : field + ".";
    for (const member of members) {
      if (!Object.prototype.hasOwnProperty.call(value, member)) {
        add("SCHEMA", prefix + member, "is required; there are no implicit defaults");
      }
    }
    for (const member of Object.keys(value)) {
      if (!members.includes(member)) add("SCHEMA", prefix + member, "is not a member of the content layer");
    }
    return true;
  };
  const has = (object: Record<string, unknown>, member: string): boolean =>
    Object.prototype.hasOwnProperty.call(object, member);

  if (!checkMembers(content, CONTENT_MEMBERS, "$")) return issues;

  // version, type (G1)
  if (has(content, "version") && checkString(content.version, "version")) {
    if (content.version !== NOTA_SCHEMA_VERSION) {
      add("G1", "version", `must be "${NOTA_SCHEMA_VERSION}"`);
    }
  }
  let type: string | undefined;
  if (has(content, "type") && checkString(content.type, "type")) {
    if (!NAME_RE.test(content.type)) {
      add("G1", "type", "must match [a-z0-9-]{1,32}");
    } else if (!isValidResourceType(content.type)) {
      add(
        "G1",
        "type",
        `"${content.type}" is not a registered resource type; add governance-added types with registerResourceType()`
      );
    } else {
      type = content.type;
    }
  }

  // chain
  let chainId: number | undefined;
  if (has(content, "chain") && checkMembers(content.chain, CHAIN_MEMBERS, "chain")) {
    const chain = content.chain;
    if (has(chain, "name") && checkString(chain.name, "chain.name") && !NAME_RE.test(chain.name)) {
      add("G1", "chain.name", "must match [a-z0-9-]{1,32}");
    }
    if (has(chain, "chainId") && checkInteger(chain.chainId, "chain.chainId")) {
      chainId = chain.chainId;
    }
    if (
      has(chain, "network") &&
      checkString(chain.network, "chain.network") &&
      !NETWORKS.includes(chain.network)
    ) {
      add("G1", "chain.network", 'must be "mainnet", "testnet" or "devnet"');
    }
  }

  // resource
  if (has(content, "resource") && checkMembers(content.resource, RESOURCE_MEMBERS, "resource")) {
    const resource = content.resource;
    if (has(resource, "identifier") && checkString(resource.identifier, "resource.identifier")) {
      if (type !== undefined && chainId !== undefined) {
        const problem = checkIdentifier(type, chainId, resource.identifier);
        if (problem !== null) add("G4", "resource.identifier", problem);
      }
    }
    if (has(resource, "name") && checkString(resource.name, "resource.name")) {
      const problem = checkDisplayString(resource.name);
      if (problem !== null) add("G6", "resource.name", problem);
    }
    if (has(resource, "alias") && checkString(resource.alias, "resource.alias")) {
      const problem = checkAlias(resource.alias);
      if (problem !== null) add("G5", "resource.alias", problem);
    }
    if (has(resource, "description") && checkString(resource.description, "resource.description")) {
      const problem = checkDisplayString(resource.description);
      if (problem !== null) add("G6", "resource.description", problem);
    }
  }

  // issuer
  if (has(content, "issuer") && checkMembers(content.issuer, ISSUER_MEMBERS, "issuer")) {
    const issuer = content.issuer;
    if (has(issuer, "account") && checkString(issuer.account, "issuer.account")) {
      if (!isEip55Address(issuer.account)) {
        add("SCHEMA", "issuer.account", "must be an EIP-55 checksummed address");
      }
    }
    if (has(issuer, "name") && checkString(issuer.name, "issuer.name")) {
      const problem = checkDisplayString(issuer.name);
      if (problem !== null) add("G6", "issuer.name", problem);
    }
    if (
      has(issuer, "entityType") &&
      checkString(issuer.entityType, "issuer.entityType") &&
      !ENTITY_TYPES.includes(issuer.entityType)
    ) {
      add("G1", "issuer.entityType", 'must be "", "individual" or "organization"');
    }
  }

  // hashes and times
  for (const member of ["metadataHash", "supersedes"] as const) {
    if (has(content, member) && checkString(content[member], member) && !isBytes32Hex(content[member])) {
      add("SCHEMA", member, "must be 0x plus 64 lowercase hex digits");
    }
  }
  if (has(content, "issuedAt")) checkInteger(content.issuedAt, "issuedAt");
  if (has(content, "expiresAt")) checkInteger(content.expiresAt, "expiresAt");

  return issues;
}

/**
 * Validates content and throws on the first issue.
 *
 * @throws NotaConformanceError naming the rule and the member.
 */
export function validateContent(
  content: unknown,
  options: ContentCheckOptions = {}
): asserts content is NotaContent {
  const issues = checkContent(content, options);
  if (issues.length > 0) {
    const { rule, field, message } = issues[0];
    throw new NotaConformanceError(rule, field, message);
  }
}

/** True when the content conforms. Never throws. */
export function isConformingContent(
  content: unknown,
  options: ContentCheckOptions = {}
): content is NotaContent {
  return checkContent(content, options).length === 0;
}
