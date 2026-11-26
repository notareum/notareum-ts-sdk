/**
 * FeeClient against the real NotareumFeeManager ABI.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { NotareumFeeManagerABI } from "../src/abi/index.js";
import { FeeClient, FeeType } from "../src/clients/fee.js";
import { ContractCallError, SignerRequiredError } from "../src/errors.js";
import { ADDRESSES, ISSUER, deployProtocol } from "./helpers/protocol.js";
import type { Protocol } from "./helpers/protocol.js";

const NOTA = 10n ** 18n;

let protocol: Protocol;
let reader: FeeClient;
let client: FeeClient;

beforeEach(() => {
  protocol = deployProtocol();
  reader = new FeeClient(ADDRESSES.feeManager, protocol.node);
  client = new FeeClient(ADDRESSES.feeManager, protocol.node, protocol.wallet());
});

describe("FeeClient", () => {
  it("calls only functions the fee manager has", () => {
    const functions = NotareumFeeManagerABI.filter((f) => f.type === "function").map((f) => f.name);
    for (const invented of ["getVerificationFee", "aliasFee", "disputeBond", "feeCollector", "setAliasFee"]) {
      expect(functions).not.toContain(invented);
    }
  });

  it("reads the split and what is pending", async () => {
    expect(await reader.getFeeConfig()).toEqual({
      burnRate: 1000n,
      treasuryRate: 2000n,
      treasury: ISSUER,
      burnAddress: "0x000000000000000000000000000000000000dEaD",
      pendingFees: 42n * NOTA,
    });
    expect(await reader.getFeesCollected(FeeType.ALIAS_REGISTRATION)).toBe(8n * NOTA);
    expect(await reader.getPendingReward(ISSUER)).toBe(5n * NOTA);
  });

  it("writes with a signer and decodes reverts", async () => {
    expect(await client.setBurnRate(1500n)).toMatch(/^0x[0-9a-f]{64}$/);
    expect((await reader.getFeeConfig()).burnRate).toBe(1500n);
    expect(await client.setTreasuryRate(2500n)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await client.claimReward()).toMatch(/^0x[0-9a-f]{64}$/);

    const failure = await client.setBurnRate(9000n).catch((e) => e);
    expect(failure).toBeInstanceOf(ContractCallError);
    expect(failure).toMatchObject({ revertName: "RateExceedsMax", revertArgs: [9000n, 5000n] });
  });

  it("guards writes behind a signer", async () => {
    await expect(reader.claimReward()).rejects.toBeInstanceOf(SignerRequiredError);
    await expect(reader.setBurnRate(1n)).rejects.toBeInstanceOf(SignerRequiredError);
  });
});
