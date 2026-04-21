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
// .nota file format
// ---------------------------------------------------------------------------
export const NOTA_SCHEMA_VERSION = "1.0";
export const NOTA_MIME_TYPE = "application/vnd.notareum.nota+json";
export const NOTA_MAX_FILE_BYTES = 64 * 1024; // 64 KB
export const NOTA_MAX_METADATA_BYTES = 32 * 1024; // 32 KB
export const NOTA_SIGNATURE_PREFIX = "Notareum v1.0 | ";
