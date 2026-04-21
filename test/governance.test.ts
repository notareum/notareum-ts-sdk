/**
 * Tests for GovernanceClient.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GovernanceClient } from "../src/clients/governance.js";
import { SignerRequiredError } from "../src/errors.js";

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ...actual,
    Contract: vi.fn().mockImplementation(() => ({
      lock: vi.fn().mockResolvedValue({ hash: "0xlockhash" }),
      extendLock: vi.fn().mockResolvedValue({ hash: "0xextendlockHash" }),
      unlock: vi.fn().mockResolvedValue({ hash: "0xunlockhash" }),
      votingPower: vi.fn().mockResolvedValue(5000n * 10n ** 18n),
      getLock: vi.fn().mockResolvedValue({
        amount: 1000n * 10n ** 18n,
        unlockTime: 1800000000n,
        votingPower: 500n * 10n ** 18n,
      }),
      totalSupply: vi.fn().mockResolvedValue(1_000_000n * 10n ** 18n),
    })),
  };
});

const mockProvider = {} as unknown as import("ethers").Provider;
const mockSigner = {} as unknown as import("ethers").Signer;
const address = "0x" + "03".repeat(20);
const holderAddr = "0x" + "ee".repeat(20);

describe("GovernanceClient (read-only)", () => {
  let client: GovernanceClient;

  beforeEach(() => {
    client = new GovernanceClient(address, mockProvider);
  });

  it("getVotingPower() returns bigint", async () => {
    const power = await client.getVotingPower(holderAddr);
    expect(power).toBe(5000n * 10n ** 18n);
  });

  it("getLock() returns VeNOTALock", async () => {
    const lock = await client.getLock(1n);
    expect(lock.lockId).toBe(1n);
    expect(lock.amount).toBe(1000n * 10n ** 18n);
    expect(lock.unlockTime).toBe(1800000000n);
  });

  it("getTotalSupply() returns bigint", async () => {
    const supply = await client.getTotalSupply();
    expect(supply).toBeGreaterThan(0n);
  });
});

describe("GovernanceClient (write ops)", () => {
  let client: GovernanceClient;

  beforeEach(() => {
    client = new GovernanceClient(address, mockProvider, mockSigner);
  });

  it("lock() returns tx hash", async () => {
    const hash = await client.lock(1000n * 10n ** 18n, 365n * 24n * 3600n);
    expect(hash).toBe("0xlockhash");
  });

  it("extendLock() returns tx hash", async () => {
    const hash = await client.extendLock(1n, 30n * 24n * 3600n);
    expect(hash).toBe("0xextendlockHash");
  });

  it("unlock() returns tx hash", async () => {
    const hash = await client.unlock(1n);
    expect(hash).toBe("0xunlockhash");
  });
});

describe("GovernanceClient (signer guard)", () => {
  it("lock() throws SignerRequiredError without signer", async () => {
    const client = new GovernanceClient(address, mockProvider);
    await expect(client.lock(1n, 1n)).rejects.toBeInstanceOf(SignerRequiredError);
  });

  it("unlock() throws SignerRequiredError without signer", async () => {
    const client = new GovernanceClient(address, mockProvider);
    await expect(client.unlock(1n)).rejects.toBeInstanceOf(SignerRequiredError);
  });
});
