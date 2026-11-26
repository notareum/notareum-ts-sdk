/**
 * deriveNotaStanding: the five states of "Trust Rules for Readers"
 * (protocol/v1.1/01-nota-format.md), decided from a read file and what the
 * registry reported.
 */

import { describe, expect, it } from "vitest";
import { NOTA_ZERO_HASH, NotaStatus, VerificationLevel, appendAnnex, buildStatusSnapshot, readNota } from "../src/core/index.js";
import type { NotaFile } from "../src/core/index.js";
import { deriveNotaStanding } from "../src/standing.js";
import type { NotaRecord } from "../src/types.js";
import { loadExample } from "./core/fixtures.js";

// The spec's worked example: an address file whose issuer is the resource.
const registered = loadExample("address-registered.nota");
const file = readNota(registered);
const MINTED_AT = file.receipt.mintedAt;

function recordOf(nota: NotaFile, overrides: Partial<NotaRecord> = {}): NotaRecord {
  return {
    notaId: nota.notaId,
    resourceId: nota.resourceId,
    issuer: nota.content.issuer.account,
    metadataHash: nota.content.metadataHash,
    supersedes: NOTA_ZERO_HASH,
    supersededBy: NOTA_ZERO_HASH,
    status: NotaStatus.REGISTERED,
    level: VerificationLevel.BASIC,
    controlProof: "self",
    ruleset: 1,
    mintedAt: MINTED_AT,
    expiresAt: 0,
    updatedAt: MINTED_AT,
    ...overrides,
  };
}

describe("without the registry", () => {
  it("is unconfirmed", () => {
    expect(deriveNotaStanding(file)).toMatchObject({
      state: "unconfirmed",
      label: "Not confirmed",
      confirmed: false,
      record: null,
      status: null,
      canonical: null,
      controlProof: "self",
    });
  });

  it("is unconfirmed whatever an annex says", () => {
    // The spec's second example carries a STAT annex claiming "verified".
    const verified = readNota(loadExample("address-verified.nota"));
    expect(verified.statusSnapshot?.status).toBe("verified");
    expect(deriveNotaStanding(verified).state).toBe("unconfirmed");

    // So does one appended by whoever passed the file along.
    const dressedUp = readNota(
      appendAnnex(registered, [
        {
          type: "STAT",
          snapshot: buildStatusSnapshot({
            asOfBlock: file.receipt.blockNumber + 10,
            asOfTime: MINTED_AT + 120,
            status: "verified",
            request: {
              level: "institutional",
              requestId: 1,
              approvals: 15,
              rejections: 0,
              transactionHash: "0x" + "22".repeat(32),
            },
          }),
        },
      ])
    );
    expect(deriveNotaStanding(dressedUp).state).toBe("unconfirmed");
    // And the registry, once asked, overrides the annex.
    expect(deriveNotaStanding(dressedUp, { record: recordOf(dressedUp) }).state).toBe("registered");
  });
});

describe("with the registry", () => {
  it("is invalid when there is no record", () => {
    const standing = deriveNotaStanding(file, { record: null });
    expect(standing).toMatchObject({ state: "invalid", label: "Invalid", confirmed: false });
  });

  it("is invalid when the record names another issuer or resource", () => {
    const otherIssuer = recordOf(file, { issuer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" });
    expect(deriveNotaStanding(file, { record: otherIssuer }).state).toBe("invalid");
    const otherResource = recordOf(file, { resourceId: "0x" + "33".repeat(32) });
    expect(deriveNotaStanding(file, { record: otherResource }).state).toBe("invalid");
  });

  it("is registered for REGISTERED and PENDING, never verified", () => {
    for (const status of [NotaStatus.REGISTERED, NotaStatus.PENDING]) {
      const standing = deriveNotaStanding(file, { record: recordOf(file, { status }), now: MINTED_AT + 60 });
      expect(standing).toMatchObject({
        state: "registered",
        label: "Registered. Not socially verified.",
        confirmed: true,
        status,
        level: null,
      });
    }
  });

  it("is socially verified, with the level, for VERIFIED", () => {
    const record = recordOf(file, { status: NotaStatus.VERIFIED, level: VerificationLevel.INSTITUTIONAL });
    const standing = deriveNotaStanding(file, { record, canonical: file.notaId });
    expect(standing).toMatchObject({
      state: "socially-verified",
      label: "Socially verified (institutional)",
      level: "institutional",
      canonical: true,
    });
    expect(deriveNotaStanding(file, { record, canonical: NOTA_ZERO_HASH }).canonical).toBe(false);
    expect(deriveNotaStanding(file, { record }).canonical).toBeNull();
  });

  it("is a warning for DISPUTED, REVOKED and SUPERSEDED", () => {
    for (const [status, word] of [
      [NotaStatus.DISPUTED, "disputed"],
      [NotaStatus.REVOKED, "revoked"],
      [NotaStatus.SUPERSEDED, "superseded"],
    ] as const) {
      const standing = deriveNotaStanding(file, { record: recordOf(file, { status }) });
      expect(standing).toMatchObject({ state: "warning", label: `Warning: ${word}`, confirmed: true });
      expect(standing.notes.length).toBeGreaterThan(0);
    }
  });

  it("takes the control proof from the record once confirmed", () => {
    const standing = deriveNotaStanding(file, { record: recordOf(file, { controlProof: "claimed" }) });
    expect(standing.controlProof).toBe("claimed");
    expect(standing.notes.join(" ")).toMatch(/claims this resource/);
  });
});

describe("expiry", () => {
  const expiring: NotaFile = { ...file, content: { ...file.content, expiresAt: MINTED_AT + 1_000 } };

  it("is a warning once expiresAt has passed, even for a verified file", () => {
    const record = recordOf(expiring, { status: NotaStatus.VERIFIED, expiresAt: MINTED_AT + 1_000 });
    expect(deriveNotaStanding(expiring, { record, now: MINTED_AT + 1_000 }).state).toBe("socially-verified");
    expect(deriveNotaStanding(expiring, { record, now: MINTED_AT + 1_001 })).toMatchObject({
      state: "warning",
      label: "Warning: expired",
      expired: true,
    });
  });

  it("warns on an expired file even before the registry is asked", () => {
    const realNow = Date.now;
    Date.now = () => (MINTED_AT + 5_000) * 1000;
    try {
      const standing = deriveNotaStanding(expiring);
      expect(standing).toMatchObject({ state: "warning", expired: true, confirmed: false });
      expect(standing.label).toMatch(/not confirmed/);
    } finally {
      Date.now = realNow;
    }
  });
});
