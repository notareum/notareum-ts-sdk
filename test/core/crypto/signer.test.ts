import { describe, it, expect } from "vitest";
import { Wallet } from "ethers";
import { signNota, signMessage, buildSigningMessage } from "../../../src/core/crypto/signer.js";
import { verifySignature, recoverSignerAddress } from "../../../src/core/crypto/verifier.js";
import { NotaSignatureError } from "../../../src/core/errors.js";
import type { NotaFile } from "../../../src/core/nota/types.js";

// Test wallet with known private key (NOT for production use)
const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = new Wallet(TEST_PRIVATE_KEY).address;

function makeUnsignedNota(): Omit<NotaFile, "signature"> {
  return {
    version: "1.0",
    type: "address",
    chain: { name: "ethereum", chainId: 1 },
    resource: { identifier: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
    verification: { status: "unverified" },
  };
}

describe("buildSigningMessage", () => {
  it("builds the correct signing message format", () => {
    const nota = makeUnsignedNota();
    const message = buildSigningMessage(nota);
    expect(message).toBe(
      "Notareum v1.0 | address:1:0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
    );
  });

  it("includes type, chainId, and identifier", () => {
    const nota: Omit<NotaFile, "signature"> = {
      version: "1.0",
      type: "contract",
      chain: { name: "polygon", chainId: 137 },
      resource: { identifier: "0xContractAddr" },
      verification: { status: "unverified" },
    };
    const message = buildSigningMessage(nota);
    expect(message).toBe("Notareum v1.0 | contract:137:0xContractAddr");
  });
});

describe("signNota", () => {
  it("signs a nota and returns a valid NotaSignature", async () => {
    const nota = makeUnsignedNota();
    const sig = await signNota(nota, TEST_PRIVATE_KEY);

    expect(sig.algorithm).toBe("ECDSA");
    expect(sig.curve).toBe("secp256k1");
    expect(sig.address).toBe(TEST_ADDRESS);
    expect(sig.message).toBe(buildSigningMessage(nota));
    expect(sig.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
    expect(sig.timestamp).toBeGreaterThan(0);
  });

  it("produces a signature that verifies correctly", async () => {
    const nota = makeUnsignedNota();
    const sig = await signNota(nota, TEST_PRIVATE_KEY);
    const isValid = verifySignature(sig.message, sig.signature, TEST_ADDRESS);
    expect(isValid).toBe(true);
  });

  it("throws NotaSignatureError for invalid private key", async () => {
    const nota = makeUnsignedNota();
    await expect(signNota(nota, "not_a_key")).rejects.toThrow(
      NotaSignatureError
    );
  });
});

describe("signMessage", () => {
  it("signs a raw message string", async () => {
    const message = "Hello, Notareum!";
    const sig = await signMessage(message, TEST_PRIVATE_KEY);
    expect(sig).toMatch(/^0x[0-9a-fA-F]{130}$/);

    const recovered = recoverSignerAddress(message, sig);
    expect(recovered).toBe(TEST_ADDRESS);
  });

  it("throws NotaSignatureError for bad key", async () => {
    await expect(signMessage("msg", "0xinvalid")).rejects.toThrow(
      NotaSignatureError
    );
  });
});
