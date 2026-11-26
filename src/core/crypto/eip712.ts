/**
 * EIP-712 hashing and signing of the v1.1 content layer
 * (protocol/v1.1/01-nota-format.md "Content Hash and notaId", "Signature").
 *
 * The content layer is hashed as typed data: the JSON object is exactly the
 * EIP-712 `message`, so no byte-level canonicalization takes part in deciding
 * a file's identity.
 */

import {
  Signature,
  TypedDataEncoder,
  Wallet,
  getAddress,
  keccak256,
  recoverAddress,
  toUtf8Bytes,
} from "ethers";
import type { TypedDataDomain, TypedDataField } from "ethers";
import { NOTA_EIP712_DOMAIN_NAME, NOTA_EIP712_DOMAIN_VERSION } from "../constants.js";
import { NotaConformanceError, NotaSignatureError } from "../errors.js";
import { isBytes32Hex, isEip55Address, validateContent } from "../nota/conformance.js";
import type { NotaContent, NotaSignature, RegistryDeployment } from "../nota/content.js";

/** The EIP-712 types of the content layer. `Nota` is the primary type. */
export const NOTA_EIP712_TYPES: Record<string, TypedDataField[]> = {
  Nota: [
    { name: "version", type: "string" },
    { name: "type", type: "string" },
    { name: "chain", type: "Chain" },
    { name: "resource", type: "Resource" },
    { name: "issuer", type: "Issuer" },
    { name: "metadataHash", type: "bytes32" },
    { name: "supersedes", type: "bytes32" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
  Chain: [
    { name: "name", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "network", type: "string" },
  ],
  Resource: [
    { name: "identifier", type: "string" },
    { name: "name", type: "string" },
    { name: "alias", type: "string" },
    { name: "description", type: "string" },
  ],
  Issuer: [
    { name: "account", type: "address" },
    { name: "name", type: "string" },
    { name: "entityType", type: "string" },
  ],
};

/** The EIP-712 primary type. */
export const NOTA_EIP712_PRIMARY_TYPE = "Nota";

/** The EIP-712 `encodeType` string of `Nota`, with its referenced types in alphabetical order. */
export const NOTA_EIP712_TYPE_STRING =
  "Nota(string version,string type,Chain chain,Resource resource,Issuer issuer,bytes32 metadataHash,bytes32 supersedes,uint64 issuedAt,uint64 expiresAt)" +
  "Chain(string name,uint256 chainId,string network)" +
  "Issuer(address account,string name,string entityType)" +
  "Resource(string identifier,string name,string alias,string description)";

/** `keccak256` of {@link NOTA_EIP712_TYPE_STRING}: the `Nota` type hash. */
export const NOTA_EIP712_TYPE_HASH = keccak256(toUtf8Bytes(NOTA_EIP712_TYPE_STRING));

/** Half the order of secp256k1. A signature with `s` above this is malleable and refused (G9). */
const SECP256K1_HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
const ECDSA_SIGNATURE_RE = /^0x[0-9a-f]{130}$/;

function checkRegistry(registry: RegistryDeployment): void {
  if (
    typeof registry !== "object" ||
    registry === null ||
    !Number.isSafeInteger(registry.chainId) ||
    registry.chainId <= 0
  ) {
    throw new NotaConformanceError("REGISTRY", "registry.chainId", "must be a positive integer");
  }
  if (!isEip55Address(registry.address)) {
    throw new NotaConformanceError(
      "REGISTRY",
      "registry.address",
      "must be an EIP-55 checksummed address"
    );
  }
}

/**
 * The EIP-712 domain of a registry deployment. Because the domain names the
 * deployment, a signed mint request cannot be replayed against a different
 * registry or chain.
 */
export function notaDomain(registry: RegistryDeployment): TypedDataDomain {
  checkRegistry(registry);
  return {
    name: NOTA_EIP712_DOMAIN_NAME,
    version: NOTA_EIP712_DOMAIN_VERSION,
    chainId: registry.chainId,
    verifyingContract: registry.address,
  };
}

/** The EIP-712 domain separator of a registry deployment. */
export function notaDomainSeparator(registry: RegistryDeployment): string {
  return TypedDataEncoder.hashDomain(notaDomain(registry));
}

/**
 * `hashStruct(Nota)` of the content.
 *
 * @throws NotaConformanceError if the content does not conform.
 */
export function hashNotaStruct(content: NotaContent): string {
  validateContent(content);
  return TypedDataEncoder.from(NOTA_EIP712_TYPES).hash(content);
}

/**
 * Computes `notaId`: the EIP-712 digest of the content under the registry's
 * domain, `keccak256(0x1901 || domainSeparator || hashStruct(Nota))`.
 *
 * @throws NotaConformanceError if the content does not conform. A `notaId`
 *   is defined only for content the gate would accept.
 */
export function computeNotaId(content: NotaContent, registry: RegistryDeployment): string {
  validateContent(content);
  return TypedDataEncoder.hash(notaDomain(registry), NOTA_EIP712_TYPES, content);
}

/** Anything that can sign EIP-712 typed data: an ethers `Signer`, or a compatible object. */
export interface NotaTypedDataSigner {
  signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>
  ): Promise<string>;
}

/**
 * Checks the form of a 65-byte ECDSA signature as the gate requires it (G9):
 * lowercase hex, `v` of 27 or 28, and low `s`. Returns a description of the
 * failure, or `null`.
 */
export function checkEcdsaSignature(signature: unknown): string | null {
  if (typeof signature !== "string" || !ECDSA_SIGNATURE_RE.test(signature)) {
    return "must be 0x plus 130 lowercase hex digits (65 bytes: r, s, v)";
  }
  const r = BigInt("0x" + signature.slice(2, 66));
  const s = BigInt("0x" + signature.slice(66, 130));
  const v = parseInt(signature.slice(130, 132), 16);
  if (v !== 27 && v !== 28) return "v must be 27 or 28";
  if (r === 0n || s === 0n) return "r and s must be non-zero";
  if (s > SECP256K1_HALF_N) return "s must be in the lower half of the curve order";
  return null;
}

/**
 * Recovers the address that produced an `eip712-secp256k1` signature over a
 * `notaId`.
 *
 * @returns The EIP-55 address of the signer.
 * @throws NotaSignatureError if the signature is malformed, has a high `s`,
 *   or does not recover.
 */
export function recoverNotaSigner(notaId: string, signature: string): string {
  if (!isBytes32Hex(notaId)) {
    throw new NotaSignatureError("notaId must be 0x plus 64 lowercase hex digits.");
  }
  const problem = checkEcdsaSignature(signature);
  if (problem !== null) {
    throw new NotaSignatureError(`Invalid signature: ${problem}.`);
  }
  try {
    return getAddress(recoverAddress(notaId, signature));
  } catch (err) {
    throw new NotaSignatureError(
      `Failed to recover signer: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Signs the content as EIP-712 typed data and returns the `SIGN` payload.
 *
 * The content is validated first: nothing the gate would refuse is signed.
 * The signer MUST be `issuer.account`; a signature that recovers to any other
 * address is refused. This function produces `eip712-secp256k1` signatures
 * only. For a contract account, obtain the ERC-1271 signature bytes from the
 * account and build the payload with `buildSignature`.
 *
 * @param content - The content layer to sign.
 * @param registry - The registry deployment the content will be minted on.
 * @param signer - An ethers `Signer`, or a 0x-prefixed private key.
 * @throws NotaConformanceError if the content does not conform.
 * @throws NotaSignatureError if signing fails or the signer is not the issuer.
 */
export async function signNotaContent(
  content: NotaContent,
  registry: RegistryDeployment,
  signer: NotaTypedDataSigner | string
): Promise<NotaSignature> {
  validateContent(content);
  const domain = notaDomain(registry);
  let typedSigner: NotaTypedDataSigner;
  if (typeof signer === "string") {
    try {
      typedSigner = new Wallet(signer);
    } catch {
      // The underlying error can echo the key; do not pass it on.
      throw new NotaSignatureError("Invalid private key.");
    }
  } else {
    typedSigner = signer;
  }

  let signature: string;
  try {
    const raw = await typedSigner.signTypedData(
      domain,
      NOTA_EIP712_TYPES,
      content as unknown as Record<string, unknown>
    );
    // Normalizes v to 27/28 and lowercases; throws on a non-canonical s.
    signature = Signature.from(raw).serialized;
  } catch (err) {
    throw new NotaSignatureError(
      `Signing failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const notaId = TypedDataEncoder.hash(domain, NOTA_EIP712_TYPES, content);
  const recovered = recoverNotaSigner(notaId, signature);
  if (recovered !== content.issuer.account) {
    throw new NotaSignatureError(
      `The signer is ${recovered}, but issuer.account is ${content.issuer.account}. ` +
        "The issuer account must sign its own content."
    );
  }
  return { scheme: "eip712-secp256k1", signature, signer: recovered };
}

/**
 * Checks an `eip712-secp256k1` signature payload against the content.
 *
 * @returns `true` if the signature recovers to `issuer.account` and `signer`
 *   equals it; `false` otherwise, including for `erc1271` signatures, which
 *   cannot be checked offline.
 */
export function verifyNotaSignature(
  content: NotaContent,
  registry: RegistryDeployment,
  signature: NotaSignature
): boolean {
  try {
    if (signature.scheme !== "eip712-secp256k1") return false;
    if (signature.signer !== content.issuer.account) return false;
    const notaId = computeNotaId(content, registry);
    return recoverNotaSigner(notaId, signature.signature) === content.issuer.account;
  } catch {
    return false;
  }
}
