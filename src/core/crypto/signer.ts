/**
 * EIP-191 personal sign for .nota files.
 *
 * Signs the canonical message derived from a NotaFile using ethers v6
 * personal sign (eth_sign / personal_sign). The message format uses
 * NOTA_SIGNATURE_PREFIX to namespace the payload.
 */

import { Wallet, getBytes, hashMessage } from "ethers";
import { NOTA_SIGNATURE_PREFIX } from "../constants.js";
import { NotaSignatureError } from "../errors.js";
import type { NotaFile, NotaSignature } from "../nota/types.js";

/**
 * Builds the canonical signing message for a .nota file.
 * Format: `Notareum v1.0 | <type>:<chainId>:<identifier>`
 */
export function buildSigningMessage(nota: Omit<NotaFile, "signature">): string {
  const { type, chain, resource } = nota;
  return `${NOTA_SIGNATURE_PREFIX}${type}:${chain.chainId}:${resource.identifier}`;
}

/**
 * Signs a .nota file using EIP-191 personal sign (eth_personalSign).
 *
 * @param nota - The unsigned nota file (without signature field).
 * @param privateKey - 0x-prefixed 32-byte private key hex string.
 * @returns A complete NotaSignature object.
 * @throws NotaSignatureError if the private key is invalid.
 */
export async function signNota(
  nota: Omit<NotaFile, "signature">,
  privateKey: string
): Promise<NotaSignature> {
  let wallet: Wallet;
  try {
    wallet = new Wallet(privateKey);
  } catch (err) {
    throw new NotaSignatureError(
      `Invalid private key: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const message = buildSigningMessage(nota);
  const signature = await wallet.signMessage(message);
  const timestamp = Math.floor(Date.now() / 1000);

  return {
    algorithm: "ECDSA",
    curve: "secp256k1",
    address: wallet.address,
    message,
    signature,
    timestamp,
  };
}

/**
 * Signs a pre-built message string using EIP-191 personal sign.
 * Returns the raw 0x-prefixed signature hex.
 *
 * @param message - The message string to sign.
 * @param privateKey - 0x-prefixed private key.
 */
export async function signMessage(
  message: string,
  privateKey: string
): Promise<string> {
  let wallet: Wallet;
  try {
    wallet = new Wallet(privateKey);
  } catch (err) {
    throw new NotaSignatureError(
      `Invalid private key: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return wallet.signMessage(message);
}

/**
 * Returns the EIP-191 message hash for a given message string.
 * Equivalent to keccak256("\x19Ethereum Signed Message:\n" + len + message).
 */
export function personalSignHash(message: string): Uint8Array {
  return getBytes(hashMessage(message));
}
