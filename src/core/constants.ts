/**
 * Protocol-wide constants matching the deployed Notareum contracts exactly.
 *
 * Sources:
 *   - NotareumValidatorStaking.sol
 *   - NotareumVerificationEngine.sol
 *   - NotareumFeeManager.sol
 *   - NotareumSlashingManager.sol
 *   - NotareumVeNOTA.sol
 */

// ---------------------------------------------------------------------------
// Staking tier minimums (NOTA with 18 decimals)
// ---------------------------------------------------------------------------
export const BASIC_MIN = 10_000n * 10n ** 18n;
export const PROFESSIONAL_MIN = 50_000n * 10n ** 18n;
export const ENTERPRISE_MIN = 250_000n * 10n ** 18n;
export const INSTITUTIONAL_MIN = 1_000_000n * 10n ** 18n;

// ---------------------------------------------------------------------------
// Slash rates (basis points, denominator = 10_000)
// ---------------------------------------------------------------------------
export const BASIC_SLASH_BPS = 2500n; // 25%
export const PROFESSIONAL_SLASH_BPS = 3500n; // 35%
export const ENTERPRISE_SLASH_BPS = 5000n; // 50%
export const INSTITUTIONAL_SLASH_BPS = 7500n; // 75%

// ---------------------------------------------------------------------------
// Reward multipliers (scaled x1000: 1.0x = 1000, 1.5x = 1500, etc.)
// ---------------------------------------------------------------------------
export const BASIC_REWARD_MUL = 1000n;
export const PROFESSIONAL_REWARD_MUL = 1500n;
export const ENTERPRISE_REWARD_MUL = 2500n;
export const INSTITUTIONAL_REWARD_MUL = 4000n;

// ---------------------------------------------------------------------------
// Daily verification limits
// ---------------------------------------------------------------------------
export const BASIC_DAILY_LIMIT = 100;
export const PROFESSIONAL_DAILY_LIMIT = 500;
export const ENTERPRISE_DAILY_LIMIT = 2500;
export const INSTITUTIONAL_DAILY_LIMIT = null; // unlimited (type(uint256).max)

// ---------------------------------------------------------------------------
// Unbonding period
// ---------------------------------------------------------------------------
export const UNBONDING_PERIOD_SECONDS = 14 * 24 * 60 * 60; // 14 days

// ---------------------------------------------------------------------------
// Verification quorum sizes
// ---------------------------------------------------------------------------
export const QUORUM_BASIC = 3;
export const QUORUM_ENHANCED = 7;
export const QUORUM_INSTITUTIONAL = 15;

// ---------------------------------------------------------------------------
// Approval thresholds (basis points)
// ---------------------------------------------------------------------------
export const THRESHOLD_BASIC = 6700n; // 67%
export const THRESHOLD_ENHANCED = 7500n; // 75%
export const THRESHOLD_INSTITUTIONAL = 7500n; // 75%
export const BPS_DENOM = 10_000n;

// ---------------------------------------------------------------------------
// Verification fees (NOTA with 18 decimals)
// ---------------------------------------------------------------------------
export const FEE_BASIC = 100n * 10n ** 18n;
export const FEE_ENHANCED = 500n * 10n ** 18n;
export const FEE_INSTITUTIONAL = 2000n * 10n ** 18n;

// ---------------------------------------------------------------------------
// Rejection refund (basis points)
// ---------------------------------------------------------------------------
export const REJECTION_REFUND_BPS = 5000n; // 50%

// ---------------------------------------------------------------------------
// Fee model
// ---------------------------------------------------------------------------
export const DEFAULT_BURN_RATE = 1000n; // 10%
export const MAX_BURN_RATE = 5000n; // 50%
export const DEFAULT_TREASURY_RATE = 2000n; // 20%
export const MAX_TREASURY_RATE = 5000n; // 50%

// ---------------------------------------------------------------------------
// Dispute bonds (NOTA with 18 decimals)
// ---------------------------------------------------------------------------
export const BOND_BASIC = 1_000n * 10n ** 18n;
export const BOND_ENHANCED = 5_000n * 10n ** 18n;
export const BOND_INSTITUTIONAL = 25_000n * 10n ** 18n;

// ---------------------------------------------------------------------------
// Reporter reward on guilty verdict (basis points)
// ---------------------------------------------------------------------------
export const REPORTER_REWARD_BPS = 1000n; // 10%

// ---------------------------------------------------------------------------
// veNOTA lock parameters
// ---------------------------------------------------------------------------
export const VENOTA_MIN_DURATION = 91 * 24 * 60 * 60; // 91 days
export const VENOTA_MAX_DURATION = 1461 * 24 * 60 * 60; // 1461 days (4 years)
export const VENOTA_MAX_MULTIPLIER = 10n;

// ---------------------------------------------------------------------------
// NOTA token
// ---------------------------------------------------------------------------
export const INITIAL_SUPPLY = 1_000_000_000n * 10n ** 18n;

// ---------------------------------------------------------------------------
// .nota file format, v1.1 (protocol/v1.1/01-nota-format.md)
// ---------------------------------------------------------------------------

/** Content schema version. The `version` member of the content layer. */
export const NOTA_SCHEMA_VERSION = "1.1";
/** Media type of a v1.1 `.nota` container. */
export const NOTA_MIME_TYPE = "application/vnd.notareum.nota";
/** File extension, including the dot. */
export const NOTA_FILE_EXTENSION = ".nota";
/** Apple Uniform Type Identifier (conforms to `public.data`). */
export const NOTA_APPLE_UTI = "com.notareum.nota";

/** Magic number at offset 0: `89 4E 4F 54 41 0D 0A 1A 0A`. */
export const NOTA_MAGIC: readonly number[] = Object.freeze([
  0x89, 0x4e, 0x4f, 0x54, 0x41, 0x0d, 0x0a, 0x1a, 0x0a,
]);
/** Container major version this library implements. */
export const NOTA_CONTAINER_VERSION_MAJOR = 1;
/** Container minor version this library writes. */
export const NOTA_CONTAINER_VERSION_MINOR = 1;
/** Header length in bytes. */
export const NOTA_HEADER_BYTES = 16;
/** Trailer length in bytes. */
export const NOTA_TRAILER_BYTES = 64;
/** Framing bytes around every object payload (type, number, length, crc). */
export const NOTA_OBJECT_OVERHEAD_BYTES = 16;
/** Trailer tag. */
export const NOTA_TRAILER_TAG = "TRLR";
/** End-of-file marker: ASCII `NOTAEOF` followed by `0A`. */
export const NOTA_EOF_MARK = "NOTAEOF\n";

// Size limits
/** Whole-file limit: 65,536 bytes. */
export const NOTA_MAX_FILE_BYTES = 65_536;
/** `CONT` payload limit: 4,096 bytes. */
export const NOTA_MAX_CONTENT_BYTES = 4_096;
/** `META` payload limit: 32,768 bytes. */
export const NOTA_MAX_METADATA_BYTES = 32_768;
/** JSON nesting depth limit for any payload. */
export const NOTA_MAX_JSON_DEPTH = 8;

/** Content-layer string limits, in UTF-8 bytes, keyed by member path. */
export const NOTA_FIELD_BYTE_LIMITS = Object.freeze({
  type: 32,
  "chain.name": 32,
  "chain.network": 16,
  "resource.identifier": 256,
  "resource.name": 64,
  "resource.alias": 68,
  "resource.description": 512,
  "issuer.name": 64,
} as const);

/** Largest integer a content-layer number may hold (2^53 - 1). */
export const NOTA_MAX_INTEGER = Number.MAX_SAFE_INTEGER;
/** Identifier length limit, in characters, for resources on chains without an EIP-155 chain ID. */
export const NOTA_MAX_NATIVE_IDENTIFIER_CHARS = 128;

// EIP-712 domain
export const NOTA_EIP712_DOMAIN_NAME = "Notareum";
export const NOTA_EIP712_DOMAIN_VERSION = "1.1";

/** 32 zero bytes: the empty value of `metadataHash` and `supersedes`. */
export const NOTA_ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

// Conformance Gate, ruleset 1 (protocol/v1.1/10-conformance-gate.md)
/** The ruleset whose rules this library enforces locally. */
export const NOTA_RULESET = 1;
/** `MINT_WINDOW`: how far `issuedAt` may precede the mint block, in seconds. */
export const MINT_WINDOW_SECONDS = 24 * 60 * 60;
/** `MAX_CLOCK_SKEW`: how far `issuedAt` may follow the mint block, in seconds. */
export const MAX_CLOCK_SKEW_SECONDS = 15 * 60;

// ---------------------------------------------------------------------------
// Legacy v1.0 JSON documents
// ---------------------------------------------------------------------------
/** Schema version of a v1.0 JSON document. */
export const NOTA_LEGACY_SCHEMA_VERSION = "1.0";
/** Media type of a v1.0 JSON document. */
export const NOTA_LEGACY_MIME_TYPE = "application/vnd.notareum.nota+json";
/** Prefix of the v1.0 EIP-191 signing message. */
export const NOTA_LEGACY_SIGNATURE_PREFIX = "Notareum v1.0 | ";
