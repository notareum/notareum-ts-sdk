# @notareum/sdk

[![npm version](https://img.shields.io/npm/v/@notareum/sdk.svg)](https://www.npmjs.com/package/@notareum/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](./tsconfig.json)

The official TypeScript SDK for the [Notareum Protocol](https://notareum.com): a decentralized verification and provenance layer for on-chain and off-chain resources.

The SDK provides a single unified entry point (`Notareum`) that exposes typed sub-clients for `.nota` file operations, the on-chain resource registry, the verification engine, validator staking, veNOTA governance, and protocol fees.

## Features

- **Unified factory.** One call (`Notareum({...})`) returns all sub-clients pre-wired to your provider, signer, and contract addresses.
- **`.nota` files.** Create, sign, parse, validate, and serialize Notareum's portable provenance file format.
- **On-chain registry.** Register, resolve, and revoke resources across any supported chain.
- **Verification engine.** Submit verification requests and read attestations issued by validators.
- **Validator staking.** Stake/unstake NOTA, query validator tier, and read validator info.
- **veNOTA governance.** Lock NOTA for veNOTA, query voting power and lock state.
- **Fees.** Query and estimate protocol fees per operation.
- **First-class types.** Strict TypeScript, ESM-only, ethers v6, no implicit any anywhere.
- **Battery-included.** Ships with bundled core (no peer-dep on a separate `@notareum/core` package) and contract ABIs.

## Installation

```bash
npm install @notareum/sdk ethers
# or
pnpm add @notareum/sdk ethers
# or
yarn add @notareum/sdk ethers
```

`ethers@^6` is a runtime dependency. Node.js >= 18 (or any environment with global `fetch`) is required.

## Quick Start

```ts
import { ethers } from "ethers";
import { Notareum } from "@notareum/sdk";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

const ntm = Notareum({
  provider,
  signer,
  contracts: {
    notaToken:          "0x...",
    veNota:             "0x...",
    validatorStaking:   "0x...",
    notaRegistry:       "0x...",
    verificationEngine: "0x...",
    slashingManager:    "0x...",
    feeManager:         "0x...",
    accessManager:      "0x...",
  },
});

// Create a signed .nota file
const nota = ntm.nota.create({
  type: "address",
  chainId: 1,
  chainName: "ethereum",
  identifier: "0xabc...",
});
const signed = await nota.sign(signer);
console.log(signed.serialize());

// Register a resource on-chain
await ntm.registry.registerResource(
  0,                                  // resource type id
  1n,                                  // chain id
  "0xabc...",                         // identifier
  "0x" + "00".repeat(32),             // metadata hash
);

// Stake to become a validator
await ntm.staking.stake(10_000n * 10n ** 18n);

// Lock NOTA for veNOTA voting power
await ntm.governance.lock(1_000n * 10n ** 18n, 365 * 24 * 60 * 60);
```

## Sub-clients

| Client          | Access            | Description                                                            |
| --------------- | ----------------- | ---------------------------------------------------------------------- |
| `nota`          | `ntm.nota`        | Off-chain `.nota` file ops: create, sign, parse, validate, serialize.  |
| `registry`      | `ntm.registry`    | On-chain resource registry: register, resolve, revoke, resource types. |
| `verification`  | `ntm.verification`| Verification requests, attestations, status reads.                     |
| `staking`       | `ntm.staking`     | Validator stake/unstake, tier and validator info.                      |
| `governance`    | `ntm.governance`  | veNOTA locking, voting power, lock lifecycle.                          |
| `fee`           | `ntm.fee`         | Protocol fee queries and estimates per operation.                      |

Each sub-client can also be imported and instantiated directly if you do not need the unified factory:

```ts
import { RegistryClient, NotaFileClient } from "@notareum/sdk";
```

## Read-only mode

If you only need to read state, omit the `signer`. Write methods will throw `SignerRequiredError`.

```ts
const ntm = Notareum({ provider, contracts });
const info = await ntm.registry.getResourceInfo(resourceId); // ok
await ntm.staking.stake(...); // throws SignerRequiredError
```

## Errors

The SDK exports typed error classes you can branch on:

- `SignerRequiredError`  -- a write was attempted without a signer.
- `ContractCallError`    -- a contract call reverted or failed.
- `ConfigurationError`   -- invalid or missing config (e.g. addresses).
- `ResourceNotFoundError`-- a registry resource was not found.

```ts
import { ContractCallError } from "@notareum/sdk";

try {
  await ntm.staking.stake(amount);
} catch (err) {
  if (err instanceof ContractCallError) {
    console.error("on-chain call failed:", err.message, err.cause);
  }
  throw err;
}
```

## Resource types

Notareum uses an extensible `uint8` resource type registry. Built-in types and helpers are re-exported:

```ts
import {
  ResourceType,
  resolveResourceTypeId,
  resolveResourceTypeString,
  registerResourceType,
} from "@notareum/sdk";

const id = resolveResourceTypeId("address"); // 0
registerResourceType("my-app:asset", 42);    // app-defined extension
```

## ABIs

Contract ABIs are exported for advanced usage (event decoding, custom callers):

```ts
import * as abi from "@notareum/sdk";
// e.g. abi.NotareumNotaRegistryAbi, abi.NotareumValidatorStakingAbi, ...
```

## API Reference

Generated TypeScript declarations ship with the package (`dist/index.d.ts`). Full docs: <https://docs.notareum.com>.

## Compatibility

| Component        | Version          |
| ---------------- | ---------------- |
| Node.js          | >= 18            |
| TypeScript       | >= 5.0           |
| `ethers`         | ^6               |
| Module format    | ESM only         |

CommonJS consumers should use a bundler (Vite, Webpack, esbuild, tsup, etc.) or dynamic `import()`.

## Development

```bash
npm install
npm run build      # tsc -> dist/
npm run test       # vitest run (159+ tests)
npm run lint       # tsc --noEmit
```

The project uses strict TypeScript, ESM, and Vitest. All public APIs are covered by tests under `test/`.

## Versioning

Semantic Versioning. Breaking changes are reserved for major bumps and noted in [CHANGELOG.md](./CHANGELOG.md) when published.

## Companion SDKs

- **Python:** [`notareum-py-sdk`](https://github.com/notareum/notareum-py-sdk)
- **Rust:**   [`notareum-rs-sdk`](https://github.com/notareum/notareum-rs-sdk)

All three SDKs share the same surface area and behaviour; pick whichever fits your stack.

## Links

- Website: <https://notareum.com>
- Docs:    <https://docs.notareum.com>
- Whitepaper: <https://notareum.com/whitepaper>
- Protocol spec: <https://github.com/notareum/protocol>
- Issues: <https://github.com/notareum/notareum-ts-sdk/issues>

## License

[MIT](./LICENSE) (c) Notareum Labs.
