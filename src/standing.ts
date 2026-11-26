/**
 * The state a reader presents for a `.nota` file
 * (protocol/v1.1/01-nota-format.md "Trust Rules for Readers").
 *
 * A reader MUST present one of five states and MUST NOT present a stronger
 * state than it has established. `deriveNotaStanding` is that decision as a
 * pure function, so that every application built on the SDK draws the same
 * line between a file that merely parses, one the registry holds, and one
 * that validators have attested to.
 */

import { NOTA_ZERO_HASH, NotaStatus, VERIFICATION_LEVEL_STRINGS } from "./core/index.js";
import type { NotaControlProof, NotaFile, VerificationLevelString } from "./core/index.js";
import type { NotaRecord } from "./types.js";

/**
 * - `invalid`: the file failed a trust rule. Refuse to load it.
 * - `unconfirmed`: well formed and signed, but the registry was not consulted.
 * - `registered`: the registry holds the record. Not socially verified.
 * - `socially-verified`: a quorum of staked validators attested to the file.
 * - `warning`: disputed, revoked, superseded or expired. Not to be offered as
 *   a transaction destination without an explicit user override.
 */
export type NotaDisplayState =
  | "invalid"
  | "unconfirmed"
  | "registered"
  | "socially-verified"
  | "warning";

/** What the registry reported when the reader performed trust rule 5. */
export interface RegistryEvidence {
  /** `getNota(notaId)`, or `null` when the registry has no record. */
  record: NotaRecord | null;
  /** `canonicalOf(resourceId)`, when it was read. */
  canonical?: string;
  /** The registry chain's current time in Unix seconds. Defaults to the local clock. */
  now?: number;
}

export interface NotaStanding {
  state: NotaDisplayState;
  /** One line for the state, in the spec's wording. */
  label: string;
  /** Why the state is `invalid` or `warning`, and anything else the user must be told. */
  notes: string[];
  /** True once the registry record was found and matched the file. */
  confirmed: boolean;
  /** The registry record, when confirmed. */
  record: NotaRecord | null;
  /** The record's status, when confirmed. */
  status: NotaStatus | null;
  /** The verification level, while the status is `VERIFIED`. */
  level: VerificationLevelString | null;
  /**
   * `"self"`: the gate established that the issuer controls the resource.
   * `"claimed"`: the issuer asserts it. Readers MUST display the two differently.
   */
  controlProof: NotaControlProof;
  /** True when `expiresAt` has passed. */
  expired: boolean;
  /** True when the file is the canonical file for its resource. `null` when not established. */
  canonical: boolean | null;
  /** `notaId` of a successor the issuer has minted, or `null`. */
  supersededBy: string | null;
}

const WARNING_STATUS: Partial<Record<NotaStatus, string>> = {
  [NotaStatus.DISPUTED]: "A content report is open against this file.",
  [NotaStatus.REVOKED]: "This file has been revoked.",
  [NotaStatus.SUPERSEDED]: "This file has been replaced by a newer version from the same issuer.",
};

/**
 * Decides the display state of a file that passed the offline trust rules
 * (`readNota`), given what the registry reported.
 *
 * Pass `evidence` only after querying a registry on the reader's own pinned
 * list. Omit it when the registry was not, or could not be, consulted: the
 * result is then `unconfirmed` however many annexes the file carries.
 */
export function deriveNotaStanding(file: NotaFile, evidence?: RegistryEvidence): NotaStanding {
  const now = evidence?.now ?? Math.floor(Date.now() / 1000);
  const expiresAt = file.content.expiresAt;
  const expired = expiresAt !== 0 && now > expiresAt;
  const base = {
    notes: [] as string[],
    confirmed: false,
    record: null as NotaRecord | null,
    status: null as NotaStatus | null,
    level: null as VerificationLevelString | null,
    controlProof: file.receipt.controlProof,
    expired,
    canonical: null as boolean | null,
    supersededBy: null as string | null,
  };
  const expiryNote = "This file expired and is no longer valid.";

  // Trust rule 5 not performed.
  if (evidence === undefined) {
    const notes = ["The registry has not been consulted, so the file may not have been minted."];
    if (expired) notes.unshift(expiryNote);
    return {
      ...base,
      state: expired ? "warning" : "unconfirmed",
      label: expired ? "Warning: expired, and not confirmed" : "Not confirmed",
      notes,
    };
  }

  // Trust rule 5 performed and failed: the receipt does not correspond to a record.
  const record = evidence.record;
  if (record === null) {
    return {
      ...base,
      state: "invalid",
      label: "Invalid",
      notes: ["The registry has no record of this file. Its receipt does not correspond to a mint."],
    };
  }
  if (
    record.issuer.toLowerCase() !== file.content.issuer.account.toLowerCase() ||
    record.resourceId.toLowerCase() !== file.resourceId.toLowerCase()
  ) {
    return {
      ...base,
      state: "invalid",
      label: "Invalid",
      notes: ["The registry record for this file names a different issuer or resource."],
    };
  }

  const supersededBy = record.supersededBy !== NOTA_ZERO_HASH ? record.supersededBy : null;
  const confirmed = {
    ...base,
    confirmed: true,
    record,
    status: record.status,
    controlProof: record.controlProof,
    canonical:
      evidence.canonical === undefined ? null : evidence.canonical.toLowerCase() === file.notaId.toLowerCase(),
    supersededBy,
  };

  const statusWarning = WARNING_STATUS[record.status];
  if (statusWarning !== undefined || expired) {
    const notes: string[] = [];
    if (statusWarning !== undefined) notes.push(statusWarning);
    if (expired) notes.push(expiryNote);
    const what =
      record.status === NotaStatus.DISPUTED
        ? "disputed"
        : record.status === NotaStatus.REVOKED
          ? "revoked"
          : record.status === NotaStatus.SUPERSEDED
            ? "superseded"
            : "expired";
    return { ...confirmed, state: "warning", label: `Warning: ${what}`, notes };
  }

  if (record.status === NotaStatus.VERIFIED) {
    const level = VERIFICATION_LEVEL_STRINGS[record.level] ?? null;
    const notes: string[] = [];
    if (supersededBy !== null) {
      notes.push("The issuer has minted a newer version of this file, which is awaiting verification.");
    }
    return {
      ...confirmed,
      state: "socially-verified",
      label: level === null ? "Socially verified" : `Socially verified (${level})`,
      level,
      notes,
    };
  }

  // REGISTERED or PENDING.
  const notes: string[] = [];
  if (record.status === NotaStatus.PENDING) notes.push("A social verification request is open for this file.");
  if (record.controlProof === "claimed") {
    notes.push(
      "The issuer claims this resource. Nothing on-chain establishes that the issuer controls it."
    );
  }
  return { ...confirmed, state: "registered", label: "Registered. Not socially verified.", notes };
}
