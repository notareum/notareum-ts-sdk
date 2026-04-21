/**
 * .nota file builder.
 *
 * Builds NotaFile objects programmatically with sensible defaults.
 */

import { NOTA_SCHEMA_VERSION } from "../constants.js";
import type {
  NotaFile,
  NotaMetadata,
  NotaSignature,
  NotaVerification,
} from "./types.js";

/**
 * Builds an unsigned .nota file from metadata.
 *
 * The returned file has a placeholder signature that MUST be replaced
 * by calling the signer module before use.
 *
 * @param meta - Resource metadata.
 * @param signature - Completed signature object (from signer module).
 * @param verification - Optional verification state.
 * @returns A complete NotaFile object.
 */
export function buildNota(
  meta: NotaMetadata,
  signature: NotaSignature,
  verification?: NotaVerification
): NotaFile {
  const nota: NotaFile = {
    version: NOTA_SCHEMA_VERSION,
    type: meta.type,
    chain: {
      name: meta.chainName,
      chainId: meta.chainId,
      ...(meta.network ? { network: meta.network } : {}),
    },
    resource: {
      identifier: meta.identifier,
      ...(meta.name ? { name: meta.name } : {}),
      ...(meta.alias ? { alias: meta.alias } : {}),
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.resourceMetadata ? { metadata: meta.resourceMetadata } : {}),
    },
    signature,
  };

  if (verification) {
    nota.verification = verification;
  } else {
    nota.verification = { status: "unverified" };
  }

  if (meta.issuerEntityType !== undefined || meta.issuerName !== undefined) {
    nota.issuer = {
      address: signature.address,
      ...(meta.issuerName ? { name: meta.issuerName } : {}),
      ...(meta.issuerEntityType ? { entityType: meta.issuerEntityType } : {}),
      verified: false,
    };
  }

  return nota;
}

/**
 * Creates an unverified .nota file with a placeholder signature.
 * Use this to construct the file structure before signing.
 *
 * @param meta - Resource metadata.
 * @returns NotaFile with placeholder signature fields.
 */
export function buildUnsignedNota(meta: NotaMetadata): Omit<NotaFile, "signature"> {
  return {
    version: NOTA_SCHEMA_VERSION,
    type: meta.type,
    chain: {
      name: meta.chainName,
      chainId: meta.chainId,
      ...(meta.network ? { network: meta.network } : {}),
    },
    resource: {
      identifier: meta.identifier,
      ...(meta.name ? { name: meta.name } : {}),
      ...(meta.alias ? { alias: meta.alias } : {}),
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.resourceMetadata ? { metadata: meta.resourceMetadata } : {}),
    },
    verification: { status: "unverified" },
    ...(meta.issuerName || meta.issuerEntityType
      ? {
          issuer: {
            address: "",
            ...(meta.issuerName ? { name: meta.issuerName } : {}),
            ...(meta.issuerEntityType ? { entityType: meta.issuerEntityType } : {}),
            verified: false,
          },
        }
      : {}),
  };
}
