/**
 * Tests for FeeClient.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FeeClient } from "../src/fee.js";
import { SignerRequiredError } from "../src/errors.js";

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ...actual,
    Contract: vi.fn().mockImplementation(() => ({
      getVerificationFee: vi.fn().mockResolvedValue(100n * 10n ** 18n),
      aliasFee: vi.fn().mockResolvedValue(50n * 10n ** 18n),
      disputeBond: vi.fn().mockResolvedValue(500n * 10n ** 18n),
      feeCollector: vi.fn().mockResolvedValue("0xcollector"),
      setVerificationFee: vi.fn().mockResolvedValue({ hash: "0xsetfeehash" }),
      setAliasFee: vi.fn().mockResolvedValue({ hash: "0xsetaliafeehash" }),
    })),
  };
});

const mockProvider = {} as unknown as import("ethers").Provider;
const mockSigner = {} as unknown as import("ethers").Signer;
const contractAddress = "0x" + "04".repeat(20);

describe("FeeClient (read-only)", () => {
  let client: FeeClient;

  beforeEach(() => {
    client = new FeeClient(contractAddress, mockProvider);
  });

  it("getVerificationFee() returns bigint", async () => {
    const fee = await client.getVerificationFee(0);
    expect(fee).toBe(100n * 10n ** 18n);
  });

  it("getAliasFee() returns bigint", async () => {
    const fee = await client.getAliasFee();
    expect(fee).toBe(50n * 10n ** 18n);
  });

  it("getDisputeBond() returns bigint", async () => {
    const bond = await client.getDisputeBond();
    expect(bond).toBe(500n * 10n ** 18n);
  });

  it("getFeeCollector() returns address string", async () => {
    const collector = await client.getFeeCollector();
    expect(collector).toBe("0xcollector");
  });

  it("getFeeConfig() returns all fee fields", async () => {
    const config = await client.getFeeConfig();
    expect(config.verificationFee).toBeDefined();
    expect(config.aliasFee).toBeDefined();
    expect(config.disputeBond).toBeDefined();
    expect(config.feeCollector).toBe("0xcollector");
  });
});

describe("FeeClient (write ops)", () => {
  let client: FeeClient;

  beforeEach(() => {
    client = new FeeClient(contractAddress, mockProvider, mockSigner);
  });

  it("setVerificationFee() returns tx hash", async () => {
    const hash = await client.setVerificationFee(0, 200n * 10n ** 18n);
    expect(hash).toBe("0xsetfeehash");
  });

  it("setAliasFee() returns tx hash", async () => {
    const hash = await client.setAliasFee(75n * 10n ** 18n);
    expect(hash).toBe("0xsetaliafeehash");
  });
});

describe("FeeClient (signer guard)", () => {
  it("setVerificationFee() throws SignerRequiredError without signer", async () => {
    const client = new FeeClient(contractAddress, mockProvider);
    await expect(client.setVerificationFee(0, 1n)).rejects.toBeInstanceOf(SignerRequiredError);
  });
});
