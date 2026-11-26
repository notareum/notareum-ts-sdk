/**
 * GovernanceClient against the real NotareumVeNOTA ABI: one NFT per lock.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { NotareumVeNOTAABI } from "../src/abi/index.js";
import { GovernanceClient } from "../src/clients/governance.js";
import { ContractCallError, SignerRequiredError } from "../src/errors.js";
import { ADDRESSES, ISSUER, OTHER, OTHER_KEY, deployProtocol } from "./helpers/protocol.js";
import type { Protocol } from "./helpers/protocol.js";

const NOTA = 10n ** 18n;
const DAY = 86_400;
const MAX_DURATION = 1461n * BigInt(DAY);

let protocol: Protocol;
let reader: GovernanceClient;
let client: GovernanceClient;

beforeEach(() => {
  protocol = deployProtocol();
  reader = new GovernanceClient(ADDRESSES.veNota, protocol.node);
  client = new GovernanceClient(ADDRESSES.veNota, protocol.node, protocol.wallet());
  protocol.approve(ISSUER, ADDRESSES.veNota, 1_000_000n * NOTA);
});

describe("the contract's real surface", () => {
  it("has the functions the client calls and none of the ones v1.0 of this SDK invented", () => {
    const functions = NotareumVeNOTAABI.filter((f) => f.type === "function").map((f) => f.name);
    expect(functions).toEqual(
      expect.arrayContaining([
        "createLock",
        "increaseLockAmount",
        "extendLock",
        "withdraw",
        "lockInfo",
        "votingPower",
        "totalVotingPower",
        "tokenOfOwnerByIndex",
      ])
    );
    for (const invented of ["lock", "unlock", "getLock"]) {
      expect(functions).not.toContain(invented);
    }
    // votingPower takes a lock's token ID, not an account.
    const votingPower = NotareumVeNOTAABI.find((f) => f.type === "function" && f.name === "votingPower");
    expect(votingPower?.inputs.map((i) => i.type)).toEqual(["uint256"]);
  });
});

describe("locks", () => {
  it("creates a lock as an NFT owned by the caller", async () => {
    expect(await client.createLock(1_000n * NOTA, 365 * DAY)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await reader.getLockIds(ISSUER)).toEqual([1n]);
    expect(await reader.getLockOwner(1n)).toBe(ISSUER);
    expect(await reader.getLockCount()).toBe(1n);

    const lock = await reader.getLock(1n);
    expect(lock).toMatchObject({
      tokenId: 1n,
      amount: 1_000n * NOTA,
      lockStart: BigInt(protocol.node.timestamp),
      lockEnd: BigInt(protocol.node.timestamp + 365 * DAY),
    });
    // Read one block later: amount * timeRemaining * 10 / MAX_DURATION.
    const remaining = BigInt(365 * DAY - protocol.node.blockTime);
    expect(lock.votingPower).toBe((1_000n * NOTA * remaining * 10n) / MAX_DURATION);
  });

  it("sums an account's voting power over the locks it owns", async () => {
    await client.createLock(1_000n * NOTA, 365 * DAY);
    await client.createLock(2_000n * NOTA, 730 * DAY);
    const other = new GovernanceClient(ADDRESSES.veNota, protocol.node, protocol.wallet(OTHER_KEY));
    protocol.approve(OTHER, ADDRESSES.veNota, 500n * NOTA);
    await other.createLock(500n * NOTA, 91 * DAY);

    const mine = await reader.getLocks(ISSUER);
    expect(mine.map((l) => l.tokenId)).toEqual([1n, 2n]);
    expect(await reader.getVotingPower(ISSUER)).toBe(mine[0].votingPower + mine[1].votingPower);
    expect(await reader.getLockVotingPower(2n)).toBe(mine[1].votingPower);
    expect(await reader.getVotingPower("0x" + "1".repeat(40))).toBe(0n);
    expect(await reader.getTotalVotingPower()).toBe(
      (await reader.getVotingPower(ISSUER)) + (await reader.getVotingPower(OTHER))
    );
    expect(await reader.getLockCount()).toBe(3n);
  });

  it("adds to, extends and withdraws a lock by token ID", async () => {
    await client.createLock(1_000n * NOTA, 91 * DAY);
    await client.increaseLockAmount(1n, 250n * NOTA);
    expect((await reader.getLock(1n)).amount).toBe(1_250n * NOTA);

    await expect(client.extendLock(1n, 91 * DAY - 3_600)).rejects.toMatchObject({
      revertName: "NewDurationNotLonger",
    });
    await client.extendLock(1n, 200 * DAY);
    expect((await reader.getLock(1n)).lockEnd).toBe(BigInt(protocol.node.timestamp + 200 * DAY));

    await expect(client.withdraw(1n)).rejects.toMatchObject({ revertName: "LockNotExpired" });
    protocol.node.mine((200 * DAY) / protocol.node.blockTime + 1);
    expect((await reader.getLock(1n)).votingPower).toBe(0n);
    await client.withdraw(1n);
    expect(await reader.getLockIds(ISSUER)).toEqual([]);
    expect(await reader.getLock(1n)).toEqual({ tokenId: 1n, amount: 0n, lockStart: 0n, lockEnd: 0n, votingPower: 0n });
  });

  it("decodes reverts", async () => {
    const short = await client.createLock(1n * NOTA, 30 * DAY).catch((e) => e);
    expect(short).toBeInstanceOf(ContractCallError);
    expect(short.revertName).toBe("DurationTooShort");

    await client.createLock(1_000n * NOTA, 91 * DAY);
    const other = new GovernanceClient(ADDRESSES.veNota, protocol.node, protocol.wallet(OTHER_KEY));
    await expect(other.withdraw(1n)).rejects.toMatchObject({ revertName: "NotLockOwner", revertArgs: [1n, OTHER] });
    await expect(reader.getLockOwner(99n)).rejects.toMatchObject({ revertName: "ERC721NonexistentToken" });
  });

  it("guards writes behind a signer", async () => {
    await expect(reader.createLock(1n, 91 * DAY)).rejects.toBeInstanceOf(SignerRequiredError);
    await expect(reader.increaseLockAmount(1n, 1n)).rejects.toBeInstanceOf(SignerRequiredError);
    await expect(reader.extendLock(1n, 91 * DAY)).rejects.toBeInstanceOf(SignerRequiredError);
    await expect(reader.withdraw(1n)).rejects.toBeInstanceOf(SignerRequiredError);
  });
});
