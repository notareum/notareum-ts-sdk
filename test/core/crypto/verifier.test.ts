import { describe, it, expect } from "vitest";
import { Wallet } from "ethers";
import {
  recoverSignerAddress,
  verifySignature,
  verifyNotaSignature,
} from "../../../src/core/crypto/verifier.js";
import { NotaSignatureError } from "../../../src/core/errors.js";
import type { NotaFile } from "../../../src/core/nota/types.js";

const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = new Wallet(TEST_PRIVATE_KEY).address;

// Pre-sign a message for deterministic tests
async function getTestSig(message: string): Promise<string> {
  const wallet = new Wallet(TEST_PRIVATE_KEY);
  return wallet.signMessage(message);
}

describe("recoverSignerAddress", () => {
  it("recovers the correct address from a valid signature", async () => {
    const message = "test message";
    const sig = await getTestSig(message);
    const recovered = recoverSignerAddress(message, sig);
    expect(recovered).toBe(TEST_ADDRESS);
  });

  it("throws NotaSignatureError for a malformed signature", () => {
    expect(() => recoverSignerAddress("msg", "not_a_sig")).toThrow(
      NotaSignatureError
    );
  });

  it("returns a checksummed Ethereum address", async () => {
    const message = "checksummed?";
    const sig = await getTestSig(message);
    const recovered = recoverSignerAddress(message, sig);
    // Checksummed address matches EIP-55 pattern
    expect(recovered).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

describe("verifySignature", () => {
  it("returns true for a valid signature from the expected address", async () => {
    const message = "verify me";
    const sig = await getTestSig(message);
    expect(verifySignature(message, sig, TEST_ADDRESS)).toBe(true);
  });

  it("returns false for a wrong expected address", async () => {
    const message = "verify me";
    const sig = await getTestSig(message);
    const wrongAddress = "0x0000000000000000000000000000000000000001";
    expect(verifySignature(message, sig, wrongAddress)).toBe(false);
  });

  it("returns false for a tampered message", async () => {
    const message = "original message";
    const sig = await getTestSig(message);
    expect(verifySignature("tampered message", sig, TEST_ADDRESS)).toBe(false);
  });

  it("returns false for a malformed signature", () => {
    expect(verifySignature("msg", "not_a_sig", TEST_ADDRESS)).toBe(false);
  });

  it("is case-insensitive for address comparison", async () => {
    const message = "case test";
    const sig = await getTestSig(message);
    expect(verifySignature(message, sig, TEST_ADDRESS.toLowerCase())).toBe(true);
    expect(verifySignature(message, sig, TEST_ADDRESS.toUpperCase())).toBe(true);
  });
});

describe("verifyNotaSignature", () => {
  it("verifies a valid nota signature", async () => {
    const message =
      "Notareum v1.0 | address:1:0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const sig = await getTestSig(message);

    const nota: NotaFile = {
      version: "1.0",
      type: "address",
      chain: { name: "ethereum", chainId: 1 },
      resource: { identifier: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" },
      signature: {
        algorithm: "ECDSA",
        curve: "secp256k1",
        address: TEST_ADDRESS,
        message,
        signature: sig,
        timestamp: 1700000000,
      },
    };

    expect(verifyNotaSignature(nota)).toBe(true);
  });

  it("returns false when signature does not match address", async () => {
    const message = "Notareum v1.0 | address:1:0xabc";
    const sig = await getTestSig(message);

    const nota: NotaFile = {
      version: "1.0",
      type: "address",
      chain: { name: "ethereum", chainId: 1 },
      resource: { identifier: "0xabc" },
      signature: {
        algorithm: "ECDSA",
        curve: "secp256k1",
        address: "0x0000000000000000000000000000000000000001",
        message,
        signature: sig,
        timestamp: 1700000000,
      },
    };

    expect(verifyNotaSignature(nota)).toBe(false);
  });

  it("returns false for EdDSA algorithm (not supported for on-chain verification)", async () => {
    const message = "Notareum v1.0 | address:1:0xabc";
    const sig = await getTestSig(message);

    const nota: NotaFile = {
      version: "1.0",
      type: "address",
      chain: { name: "solana", chainId: 0 },
      resource: { identifier: "0xabc" },
      signature: {
        algorithm: "EdDSA",
        curve: "ed25519",
        address: TEST_ADDRESS,
        message,
        signature: sig,
        timestamp: 1700000000,
      },
    };

    expect(verifyNotaSignature(nota)).toBe(false);
  });
});
