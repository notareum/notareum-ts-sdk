/**
 * Signature verification utilities.
 *
 * Recovers the signing address from an EIP-191 personal sign signature
 * and checks it against an expected address.
 */

import { verifyMessage } from "ethers";
import { NotaSignatureError } from "../errors.js";
import type { NotaFile } from "../nota/types.js";

/**
 * Recovers the address that signed a message using EIP-191 personal sign.
 *
 * @param message - The original message string that was signed.
 * @param signature - 0x-prefixed 65-byte ECDSA signature.
 * @returns Checksummed Ethereum address of the signer.
 * @throws NotaSignatureError if recovery fails.
 */
export function recoverSignerAddress(message: string, signature: string): string {
  try {
    return verifyMessage(message, signature);
  } catch (err) {
    throw new NotaSignatureError(
      `Failed to recover signer address: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Verifies that a signature was made by a specific address.
 *
 * @param message - The original signed message.
 * @param signature - 0x-prefixed 65-byte ECDSA signature.
 * @param expectedAddress - Ethereum address to check against (case-insensitive).
 * @returns true if the signature is valid for the expected address.
 */
export function verifySignature(
  message: string,
  signature: string,
  expectedAddress: string
): boolean {
  try {
    const recovered = recoverSignerAddress(message, signature);
    return recovered.toLowerCase() === expectedAddress.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Verifies the signature embedded in a NotaFile.
 *
 * @param nota - The complete NotaFile including the signature section.
 * @returns true if the embedded signature is valid for the embedded address.
 */
export function verifyNotaSignature(nota: NotaFile): boolean {
  if (nota.signature.algorithm !== "ECDSA" || nota.signature.curve !== "secp256k1") {
    // Only ECDSA/secp256k1 supported for on-chain verification
    return false;
  }
  return verifySignature(
    nota.signature.message,
    nota.signature.signature,
    nota.signature.address
  );
}
