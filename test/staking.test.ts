/**
 * Tests for StakingClient.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { StakingClient, ValidatorTier } from "../src/staking.js";
import { SignerRequiredError } from "../src/errors.js";

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ...actual,
    Contract: vi.fn().mockImplementation(() => ({
      stake: vi.fn().mockResolvedValue({ hash: "0xstakehash" }),
      unstake: vi.fn().mockResolvedValue({ hash: "0xunstakehash" }),
      claimStake: vi.fn().mockResolvedValue({ hash: "0xclaimhash" }),
      getValidator: vi.fn().mockResolvedValue({
        stakedAmount: 50000n * 10n ** 18n,
        tier: 2n,
        isActive: true,
        slashCount: 0n,
        dailyVerifications: 10n,
        lastVerificationDay: 19000n,
        unbondingAmount: 0n,
        unbondingEndTime: 0n,
      }),
      getTier: vi.fn().mockResolvedValue(2n),
      getDailyVerificationsRemaining: vi.fn().mockResolvedValue(90n),
      TIER_THRESHOLDS: vi.fn().mockResolvedValue(10000n * 10n ** 18n),
    })),
  };
});

const mockProvider = {} as unknown as import("ethers").Provider;
const mockSigner = {} as unknown as import("ethers").Signer;
const address = "0x" + "02".repeat(20);
const validatorAddr = "0x" + "ff".repeat(20);

describe("StakingClient (read-only)", () => {
  let client: StakingClient;

  beforeEach(() => {
    client = new StakingClient(address, mockProvider);
  });

  it("getValidatorInfo() returns ValidatorInfo", async () => {
    const info = await client.getValidatorInfo(validatorAddr);
    expect(info.tier).toBe(ValidatorTier.SILVER);
    expect(info.isActive).toBe(true);
    expect(info.stakedAmount).toBe(50000n * 10n ** 18n);
  });

  it("getTier() returns a ValidatorTier", async () => {
    const tier = await client.getTier(validatorAddr);
    expect(tier).toBe(ValidatorTier.SILVER);
  });

  it("getDailyVerificationsRemaining() returns bigint", async () => {
    const remaining = await client.getDailyVerificationsRemaining(validatorAddr);
    expect(remaining).toBe(90n);
  });

  it("getTierThreshold() returns bigint", async () => {
    const threshold = await client.getTierThreshold(ValidatorTier.BRONZE);
    expect(threshold).toBeGreaterThan(0n);
  });
});

describe("StakingClient (write ops)", () => {
  let client: StakingClient;

  beforeEach(() => {
    client = new StakingClient(address, mockProvider, mockSigner);
  });

  it("stake() returns tx hash", async () => {
    const hash = await client.stake(10000n * 10n ** 18n);
    expect(hash).toBe("0xstakehash");
  });

  it("unstake() returns tx hash", async () => {
    const hash = await client.unstake();
    expect(hash).toBe("0xunstakehash");
  });

  it("claimStake() returns tx hash", async () => {
    const hash = await client.claimStake();
    expect(hash).toBe("0xclaimhash");
  });
});

describe("StakingClient (signer guard)", () => {
  it("stake() throws SignerRequiredError without signer", async () => {
    const client = new StakingClient(address, mockProvider);
    await expect(client.stake(1n)).rejects.toBeInstanceOf(SignerRequiredError);
  });

  it("unstake() throws SignerRequiredError without signer", async () => {
    const client = new StakingClient(address, mockProvider);
    await expect(client.unstake()).rejects.toBeInstanceOf(SignerRequiredError);
  });
});

describe("ValidatorTier enum values", () => {
  it("has correct numeric values", () => {
    expect(ValidatorTier.NONE).toBe(0);
    expect(ValidatorTier.BRONZE).toBe(1);
    expect(ValidatorTier.SILVER).toBe(2);
    expect(ValidatorTier.GOLD).toBe(3);
    expect(ValidatorTier.PLATINUM).toBe(4);
  });
});
