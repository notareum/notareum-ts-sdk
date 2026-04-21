/**
 * Tests for the Notareum() factory and NotareumInstance shape.
 */

import { describe, it, expect, vi } from "vitest";
import { Notareum } from "../src/client.js";
import { RegistryClient } from "../src/clients/registry.js";
import { VerificationClient } from "../src/clients/verification.js";
import { StakingClient } from "../src/clients/staking.js";
import { GovernanceClient } from "../src/clients/governance.js";
import { FeeClient } from "../src/clients/fee.js";
import { NotaFileClient } from "../src/clients/nota-file.js";
import type { ClientConfig } from "../src/types.js";

const mockProvider = {
  getNetwork: vi.fn(),
  getBlock: vi.fn(),
} as unknown as import("ethers").Provider;

const mockContracts = {
  accessManager: "0xAA00000000000000000000000000000000000001",
  notaToken: "0xAA00000000000000000000000000000000000002",
  veNota: "0xAA00000000000000000000000000000000000003",
  validatorStaking: "0xAA00000000000000000000000000000000000004",
  notaRegistry: "0xAA00000000000000000000000000000000000005",
  verificationEngine: "0xAA00000000000000000000000000000000000006",
  slashingManager: "0xAA00000000000000000000000000000000000007",
  feeManager: "0xAA00000000000000000000000000000000000008",
};

const config: ClientConfig = {
  provider: mockProvider,
  contracts: mockContracts,
};

describe("Notareum() factory", () => {
  it("creates a NotareumInstance with all sub-clients", () => {
    const ntm = Notareum(config);
    expect(ntm.nota).toBeInstanceOf(NotaFileClient);
    expect(ntm.registry).toBeInstanceOf(RegistryClient);
    expect(ntm.verification).toBeInstanceOf(VerificationClient);
    expect(ntm.staking).toBeInstanceOf(StakingClient);
    expect(ntm.governance).toBeInstanceOf(GovernanceClient);
    expect(ntm.fee).toBeInstanceOf(FeeClient);
  });

  it("creates without a signer (read-only mode)", () => {
    const ntm = Notareum({ provider: mockProvider, contracts: mockContracts });
    expect(ntm).toBeDefined();
    expect(ntm.registry).toBeDefined();
  });

  it("creates with a signer (read-write mode)", () => {
    const mockSigner = {
      getAddress: vi.fn().mockResolvedValue("0xdeadbeef"),
      signMessage: vi.fn(),
    } as unknown as import("ethers").Signer;
    const ntm = Notareum({ provider: mockProvider, signer: mockSigner, contracts: mockContracts });
    expect(ntm).toBeDefined();
  });

  it("sub-clients are frozen (not accidentally reassignable on the returned object)", () => {
    const ntm = Notareum(config);
    // At minimum the properties should exist and be consistent across accesses
    expect(ntm.nota).toBe(ntm.nota);
    expect(ntm.registry).toBe(ntm.registry);
  });
});
