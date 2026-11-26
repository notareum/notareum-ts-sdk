/**
 * VerificationClient against the real ABI: requests and attestations by notaId.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Notareum } from "../src/client.js";
import type { NotareumInstance } from "../src/client.js";
import { VerificationClient } from "../src/clients/verification.js";
import { NotaStatus, VerificationLevel } from "../src/core/index.js";
import { ContractCallError, SignerRequiredError } from "../src/errors.js";
import { ADDRESSES, ISSUER, OTHER, OTHER_KEY, deployProtocol } from "./helpers/protocol.js";
import type { Protocol } from "./helpers/protocol.js";

const NOTA = 10n ** 18n;
const VALIDATOR_KEYS = [
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
];

let protocol: Protocol;
let ntm: NotareumInstance;
let notaId: string;

beforeEach(async () => {
  protocol = deployProtocol();
  ntm = Notareum({ provider: protocol.node, signer: protocol.wallet(), contracts: ADDRESSES });
  const minted = await ntm.nota.create({
    type: "address",
    chainName: "ethereum",
    chainId: 1,
    identifier: ISSUER,
  });
  notaId = minted.notaId;
});

function validator(key: string): VerificationClient {
  const wallet = protocol.wallet(key);
  protocol.validators.set(wallet.address.toLowerCase(), {
    stakedAmount: 10_000n * NOTA,
    dailyVerifications: 0n,
    lastResetDay: 0n,
  });
  return new VerificationClient(ADDRESSES.verificationEngine, protocol.node, wallet);
}

describe("constants", () => {
  it("reads fees and quorums per level", async () => {
    expect(await ntm.verification.getVerificationFee(VerificationLevel.BASIC)).toBe(100n * NOTA);
    expect(await ntm.verification.getVerificationFee(VerificationLevel.ENHANCED)).toBe(500n * NOTA);
    expect(await ntm.verification.getVerificationFee(VerificationLevel.INSTITUTIONAL)).toBe(2000n * NOTA);
    expect(await ntm.verification.getQuorum(VerificationLevel.BASIC)).toBe(3);
    expect(await ntm.verification.getQuorum(VerificationLevel.INSTITUTIONAL)).toBe(15);
  });
});

describe("requestVerification", () => {
  it("surfaces the missing fee allowance before sending", async () => {
    const failure = await ntm.verification.requestVerification(notaId, VerificationLevel.BASIC).catch((e) => e);
    expect(failure).toBeInstanceOf(ContractCallError);
    expect(failure.revertName).toBe("ERC20InsufficientAllowance");
    expect(protocol.node.callsTo("requestVerification").some((c) => c.mutating)).toBe(false);
  });

  it("opens a request for a notaId and moves the file to PENDING", async () => {
    protocol.approve(ISSUER, ADDRESSES.verificationEngine, 100n * NOTA);
    const hash = await ntm.verification.requestVerification(notaId, VerificationLevel.BASIC);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(protocol.node.callsTo("requestVerification").at(-1)).toMatchObject({
      args: [notaId, BigInt(VerificationLevel.BASIC)],
      from: ISSUER,
      mutating: true,
    });
    expect((await ntm.registry.getNota(notaId))?.status).toBe(NotaStatus.PENDING);
    expect(await ntm.verification.getAttestations(notaId)).toEqual({
      requestId: 1n,
      approvals: 0n,
      rejections: 0n,
      resolved: false,
    });
    expect(await ntm.verification.getVerificationRequest(1)).toEqual({
      requestId: 1n,
      notaId,
      level: VerificationLevel.BASIC,
      requester: ISSUER,
      feeDeposited: 100n * NOTA,
      approvals: 0n,
      rejections: 0n,
      resolved: false,
    });
  });

  it("refuses a second request and a file that is not verifiable", async () => {
    protocol.approve(ISSUER, ADDRESSES.verificationEngine, 1_000n * NOTA);
    await ntm.verification.requestVerification(notaId, VerificationLevel.BASIC);
    await expect(ntm.verification.requestVerification(notaId, VerificationLevel.BASIC)).rejects.toMatchObject({
      revertName: "AlreadyPendingVerification",
    });
    await expect(
      ntm.verification.requestVerification("0x" + "ee".repeat(32), VerificationLevel.BASIC)
    ).rejects.toMatchObject({ revertName: "NotVerifiable" });
  });

  it("takes a 32-byte notaId and a signer", async () => {
    await expect(ntm.verification.requestVerification("treasury.nota", 0)).rejects.toThrow(/32-byte/);
    const reader = new VerificationClient(ADDRESSES.verificationEngine, protocol.node);
    await expect(reader.requestVerification(notaId, 0)).rejects.toBeInstanceOf(SignerRequiredError);
    await expect(reader.submitAttestation(notaId, true)).rejects.toBeInstanceOf(SignerRequiredError);
  });
});

describe("submitAttestation", () => {
  beforeEach(async () => {
    protocol.approve(ISSUER, ADDRESSES.verificationEngine, 100n * NOTA);
    await ntm.verification.requestVerification(notaId, VerificationLevel.BASIC);
  });

  it("is refused for an account that is not a validator", async () => {
    const stranger = new VerificationClient(ADDRESSES.verificationEngine, protocol.node, protocol.wallet(OTHER_KEY));
    const failure = await stranger.submitAttestation(notaId, true).catch((e) => e);
    expect(failure).toBeInstanceOf(ContractCallError);
    expect(failure).toMatchObject({ revertName: "NotAValidator", revertArgs: [OTHER] });
  });

  it("verifies the file once a quorum of validators approves", async () => {
    const [a, b, c] = VALIDATOR_KEYS.map(validator);
    await a.submitAttestation(notaId, true);
    await expect(a.submitAttestation(notaId, true)).rejects.toMatchObject({ revertName: "AlreadyVoted" });
    await b.submitAttestation(notaId, true);
    expect(await ntm.verification.getAttestations(notaId)).toMatchObject({ approvals: 2n, rejections: 0n });
    await c.submitAttestation(notaId, true);

    const record = await ntm.registry.getNota(notaId);
    expect(record).toMatchObject({ status: NotaStatus.VERIFIED, level: VerificationLevel.BASIC });
    expect(await ntm.registry.canonicalOf(record!.resourceId)).toBe(notaId);
    // The request is closed, so the file has no open request any more.
    expect((await ntm.verification.getAttestations(notaId)).requestId).toBe(0n);
    expect(await ntm.verification.getVerificationRequest(1)).toMatchObject({ approvals: 3n, resolved: true });
  });

  it("returns the file to REGISTERED when the quorum rejects", async () => {
    const [a, b, c] = VALIDATOR_KEYS.map(validator);
    await a.submitAttestation(notaId, false);
    await b.submitAttestation(notaId, false);
    await c.submitAttestation(notaId, true);
    expect((await ntm.registry.getNota(notaId))?.status).toBe(NotaStatus.REGISTERED);
  });
});

describe("getVerificationRequest", () => {
  it("returns null for a request that does not exist", async () => {
    expect(await ntm.verification.getVerificationRequest(99n)).toBeNull();
  });
});
