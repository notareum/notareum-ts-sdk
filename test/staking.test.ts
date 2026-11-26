/**
 * StakingClient against the real NotareumValidatorStaking ABI.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { NotareumValidatorStakingABI } from "../src/abi/index.js";
import { StakingClient } from "../src/clients/staking.js";
import { StakingTier } from "../src/core/index.js";
import { ContractCallError, SignerRequiredError } from "../src/errors.js";
import { ADDRESSES, ISSUER, OTHER, deployProtocol } from "./helpers/protocol.js";
import type { Protocol } from "./helpers/protocol.js";

const NOTA = 10n ** 18n;

let protocol: Protocol;
let reader: StakingClient;
let client: StakingClient;

beforeEach(() => {
  protocol = deployProtocol();
  reader = new StakingClient(ADDRESSES.validatorStaking, protocol.node);
  client = new StakingClient(ADDRESSES.validatorStaking, protocol.node, protocol.wallet());
});

describe("the contract's real surface", () => {
  it("has the functions the client calls and none of the ones v1.0 of this SDK invented", () => {
    const functions = NotareumValidatorStakingABI.filter((f) => f.type === "function").map((f) => f.name);
    expect(functions).toEqual(
      expect.arrayContaining([
        "stake",
        "requestUnstake",
        "completeUnstake",
        "claimRewards",
        "getValidatorInfo",
        "getUnbondingRequests",
        "isValidator",
        "slashRateForTier",
      ])
    );
    for (const invented of ["getValidator", "unstake", "claimStake", "getTier", "TIER_THRESHOLDS"]) {
      expect(functions).not.toContain(invented);
    }
  });
});

describe("staking", () => {
  it("reports an account that never staked as tier NONE", async () => {
    expect(await reader.getValidatorInfo(OTHER)).toEqual({
      stakedAmount: 0n,
      tier: StakingTier.NONE,
      accuracyNumerator: 0n,
      accuracyDenominator: 0n,
      verificationCount: 0n,
      rewardsAccrued: 0n,
      dailyVerifications: 0n,
      lastResetDay: 0n,
    });
    expect(await reader.isValidator(OTHER)).toBe(false);
    expect(await reader.getTier(OTHER)).toBe(StakingTier.NONE);
  });

  it("stakes, after the allowance is in place", async () => {
    await expect(client.stake(50_000n * NOTA)).rejects.toMatchObject({ revertName: "ERC20InsufficientAllowance" });
    protocol.approve(ISSUER, ADDRESSES.validatorStaking, 50_000n * NOTA);
    expect(await client.stake(50_000n * NOTA)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await reader.getValidatorInfo(ISSUER)).toMatchObject({
      stakedAmount: 50_000n * NOTA,
      tier: StakingTier.PROFESSIONAL,
    });
    expect(await reader.isValidator(ISSUER)).toBe(true);
  });

  it("decodes the minimum-stake revert", async () => {
    const failure = await client.stake(5n * NOTA).catch((e) => e);
    expect(failure).toBeInstanceOf(ContractCallError);
    expect(failure).toMatchObject({ revertName: "BelowMinimumStake", revertArgs: [5n * NOTA, 10_000n * NOTA] });
  });

  it("unbonds by amount and completes after the release time", async () => {
    protocol.approve(ISSUER, ADDRESSES.validatorStaking, 60_000n * NOTA);
    await client.stake(60_000n * NOTA);
    await client.requestUnstake(20_000n * NOTA);

    expect((await reader.getValidatorInfo(ISSUER)).stakedAmount).toBe(40_000n * NOTA);
    const [request] = await reader.getUnbondingRequests(ISSUER);
    expect(request).toEqual({
      index: 0,
      amount: 20_000n * NOTA,
      releaseTime: BigInt(protocol.node.timestamp + 14 * 86_400),
      claimed: false,
    });

    await expect(client.completeUnstake()).rejects.toMatchObject({ revertName: "NothingToClaim" });
    protocol.node.mine((14 * 86_400) / protocol.node.blockTime + 1);
    await client.completeUnstake();
    expect((await reader.getUnbondingRequests(ISSUER))[0].claimed).toBe(true);
  });

  it("refuses to unstake more than is staked", async () => {
    await expect(client.requestUnstake(1n)).rejects.toMatchObject({ revertName: "NotAValidator" });
    await expect(client.claimRewards()).rejects.toMatchObject({ revertName: "NothingToClaim" });
  });

  it("guards writes behind a signer", async () => {
    await expect(reader.stake(1n)).rejects.toBeInstanceOf(SignerRequiredError);
    await expect(reader.requestUnstake(1n)).rejects.toBeInstanceOf(SignerRequiredError);
    await expect(reader.completeUnstake()).rejects.toBeInstanceOf(SignerRequiredError);
    await expect(reader.claimRewards()).rejects.toBeInstanceOf(SignerRequiredError);
  });
});

describe("tiers", () => {
  it("knows the tier minimums and slash rates", async () => {
    expect(reader.getTierMinimum(StakingTier.NONE)).toBeNull();
    expect(reader.getTierMinimum(StakingTier.BASIC)).toBe(10_000n * NOTA);
    expect(reader.getTierMinimum(StakingTier.INSTITUTIONAL)).toBe(1_000_000n * NOTA);
    expect(await reader.getSlashRate(StakingTier.ENTERPRISE)).toBe(5000n);
  });

  it("counts the attestations left today the way the contract resets them", async () => {
    const today = BigInt(Math.floor(protocol.node.timestamp / 86_400));
    protocol.validators.set(ISSUER.toLowerCase(), {
      stakedAmount: 10_000n * NOTA,
      dailyVerifications: 40n,
      lastResetDay: today,
    });
    expect(await reader.getDailyVerificationsRemaining(ISSUER)).toBe(60n);

    // Yesterday's count no longer applies.
    protocol.validators.get(ISSUER.toLowerCase())!.lastResetDay = today - 1n;
    expect(await reader.getDailyVerificationsRemaining(ISSUER)).toBe(100n);

    protocol.validators.get(ISSUER.toLowerCase())!.stakedAmount = 1_000_000n * NOTA;
    expect(await reader.getDailyVerificationsRemaining(ISSUER)).toBeNull();
    expect(await reader.getDailyVerificationsRemaining(OTHER)).toBe(0n);
  });
});
