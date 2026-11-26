/**
 * The Notareum() factory, the package's public surface, and the shipped ABIs.
 */

import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.js";
import { Notareum } from "../src/client.js";
import { FeeClient } from "../src/clients/fee.js";
import { GovernanceClient } from "../src/clients/governance.js";
import { NotaFileClient } from "../src/clients/nota-file.js";
import { RegistryClient } from "../src/clients/registry.js";
import { StakingClient } from "../src/clients/staking.js";
import { VerificationClient } from "../src/clients/verification.js";
import { ADDRESSES, ISSUER, deployProtocol } from "./helpers/protocol.js";

describe("Notareum() factory", () => {
  it("creates a NotareumInstance with all sub-clients", () => {
    const { node } = deployProtocol();
    const ntm = Notareum({ provider: node, contracts: ADDRESSES });
    expect(ntm.nota).toBeInstanceOf(NotaFileClient);
    expect(ntm.registry).toBeInstanceOf(RegistryClient);
    expect(ntm.verification).toBeInstanceOf(VerificationClient);
    expect(ntm.staking).toBeInstanceOf(StakingClient);
    expect(ntm.governance).toBeInstanceOf(GovernanceClient);
    expect(ntm.fee).toBeInstanceOf(FeeClient);
    expect(ntm.registry.address).toBe(ADDRESSES.notaRegistry);
  });

  it("does not need the gate address: the registry names its gate", async () => {
    const protocol = deployProtocol();
    const { conformanceGate, ...withoutGate } = ADDRESSES;
    const ntm = Notareum({ provider: protocol.node, signer: protocol.wallet(), contracts: withoutGate });
    expect(await ntm.registry.conformanceGate()).toBe(conformanceGate);
    const minted = await ntm.nota.create({ type: "address", chainName: "ethereum", chainId: 1, identifier: ISSUER });
    expect((await ntm.nota.verify(minted.file)).standing.state).toBe("registered");
  });

  it("waits for the configured number of confirmations before writing the file", async () => {
    const protocol = deployProtocol();
    const ntm = Notareum({
      provider: protocol.node,
      signer: protocol.wallet(),
      contracts: ADDRESSES,
      confirmations: 3,
      pollingInterval: 5,
    });
    let settled = false;
    const pending = ntm.nota
      .create({ type: "address", chainName: "ethereum", chainId: 1, identifier: ISSUER })
      .then((minted) => {
        settled = true;
        return minted;
      });
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    // Wait until the mint has been mined, then confirm that one block is not enough.
    while (protocol.node.callsTo("mint").filter((c) => c.mutating).length === 0) await sleep(5);
    const mintedAt = protocol.node.height;
    await sleep(60);
    expect(settled).toBe(false);
    // Blocks keep coming, as on a live chain; the file appears once the mint is three deep.
    while (!settled) {
      protocol.node.mine(1);
      await sleep(20);
    }
    const minted = await pending;
    expect(minted.blockNumber).toBe(mintedAt);
    expect(protocol.node.height - mintedAt + 1).toBeGreaterThanOrEqual(3);
  });
});

describe("public surface", () => {
  it("exports the v1.1 API", () => {
    for (const name of [
      "Notareum",
      "RegistryClient",
      "VerificationClient",
      "StakingClient",
      "GovernanceClient",
      "FeeClient",
      "NotaFileClient",
      "readNota",
      "composeNotaDraft",
      "computeNotaId",
      "notaTypedData",
      "mintArguments",
      "signatureFromWallet",
      "notaFileFromMintLog",
      "deriveNotaStanding",
      "importLegacyNota",
      "describeGateRule",
      "ConformanceFailedError",
      "UntrustedRegistryError",
      "NotaStatus",
      "VerificationLevel",
      "StakingTier",
      "NotareumNotaRegistryABI",
      "NotareumConformanceGateABI",
    ]) {
      expect(sdk, name).toHaveProperty(name);
    }
  });

  it("names statuses the v1.1 way", () => {
    expect(sdk.NotaStatus[0]).toBe("REGISTERED");
    expect(sdk.NotaStatus[5]).toBe("SUPERSEDED");
    expect(sdk).not.toHaveProperty("VerificationStatus");
    expect(sdk).not.toHaveProperty("NotaBuilder");
    expect(sdk.StakingTier.PROFESSIONAL).toBe(2);
    expect(sdk.NOTA_MIME_TYPE).toBe("application/vnd.notareum.nota");
  });
});

describe("shipped ABIs", () => {
  const functionsOf = (abi: ReadonlyArray<{ type: string; name?: string }>) =>
    abi.filter((f) => f.type === "function").map((f) => f.name);

  it("describe the v1.1 registry", () => {
    const registry = functionsOf(sdk.NotareumNotaRegistryABI);
    expect(registry).toEqual(
      expect.arrayContaining(["mint", "getNota", "getResource", "headOf", "canonicalOf", "resolveAlias", "revoke", "isLive"])
    );
    for (const removed of ["register", "updateResource", "registerAlias", "revokeResource"]) {
      expect(registry).not.toContain(removed);
    }
    const events = sdk.NotareumNotaRegistryABI.filter((f) => f.type === "event").map((f) => f.name);
    expect(events).toContain("NotaMinted");
  });

  it("include the Conformance Gate", () => {
    expect(functionsOf(sdk.NotareumConformanceGateABI)).toEqual(expect.arrayContaining(["check", "RULESET"]));
    const errors = sdk.NotareumConformanceGateABI.filter((f) => f.type === "error").map((f) => f.name);
    expect(errors).toContain("ConformanceFailed");
  });

  it("key verification by notaId", () => {
    const request = sdk.NotareumVerificationEngineABI.find(
      (f) => f.type === "function" && f.name === "requestVerification"
    );
    expect(request?.inputs.map((i) => i.name)).toEqual(["notaId", "level"]);
  });
});
