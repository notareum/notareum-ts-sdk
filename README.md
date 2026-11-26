# @notareum/sdk

[![npm version](https://img.shields.io/npm/v/@notareum/sdk.svg)](https://www.npmjs.com/package/@notareum/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](./tsconfig.json)

The official TypeScript SDK for the [Notareum Protocol](https://notareum.com), **protocol v1.1**: a format and an on-chain registry for sharing blockchain resources as verified `.nota` files.

> **v1.1 is not compatible with v1.0.** A `.nota` file is now a binary container that is created by minting it through the registry. `register()`, `updateResource()`, `registerAlias()` and `proofHash` are gone, signing is EIP-712 instead of EIP-191, and verification is keyed by `notaId` instead of `resourceId`. See [Migrating from 1.x](#migrating-from-1x).

## What v1.1 means for an integrator

- **A file exists only once it is minted.** `mint(nota, metadata, signature)` passes the content through the Conformance Gate, creates the registry record and emits everything the file contains. Content that has not been minted is a *draft* and must not be saved as `.nota`.
- **Two identifiers.** `notaId` identifies one minted file: it is the EIP-712 digest of the content under the registry's domain. `resourceId` identifies the resource the file describes. Several files can describe one resource.
- **Two stages of verification.** *Registry verification* is automatic: every file is on the registry. *Social verification* is the optional second stage in which staked validators attest to a file; `VERIFIED` is its outcome. A registered file is not a verified one, and a reader must not blur the two.

## Installation

```bash
npm install @notareum/sdk ethers
```

`ethers@^6.13` is a runtime dependency. Node.js >= 18 or a modern browser. ESM only.

## Quick start

```ts
import { ethers } from "ethers";
import { writeFile } from "node:fs/promises";
import { Notareum, VerificationLevel } from "@notareum/sdk";

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

const ntm = Notareum({
  provider,
  signer,
  contracts: {
    notaRegistry:       "0x...",
    verificationEngine: "0x...",
    validatorStaking:   "0x...",
    veNota:             "0x...",
    notaToken:          "0x...",
    feeManager:         "0x...",
    slashingManager:    "0x...",
    accessManager:      "0x...",
    // conformanceGate is optional: the registry names its current gate.
  },
});

// Create a .nota file by minting it: compose, preflight, sign, mint, write.
const minted = await ntm.nota.create({
  type: "address",
  chainName: "ethereum",
  chainId: 1,
  identifier: await signer.getAddress(),
  name: "Treasury",
});
await writeFile(minted.fileName, minted.file);

// Read a file someone sent you and establish what may be said about it.
const { file, standing } = await ntm.nota.verify(bytes);
console.log(standing.label); // "Registered. Not socially verified."

// Ask validators to attest to it (needs a NOTA allowance for the fee).
await ntm.verification.requestVerification(minted.notaId, VerificationLevel.BASIC);
```

## The mint flow

`ntm.nota.create()` runs these steps. Each is also available on its own.

| Step | Call | What happens |
| --- | --- | --- |
| 1. Compose | `ntm.nota.compose(input)` | Builds the content layer and canonical metadata and checks them against every gate rule that can be decided locally. Fills `issuedAt` from the registry chain's clock and `supersedes` from the issuer's current file for the resource. Returns a draft. |
| 2. Preflight | `ntm.registry.check(draft)` | Calls the gate's `check()` as a read, at no cost. Unsigned, a result with `readyToSign` passed every rule except the signature rule, which the gate evaluates last. |
| 3. Sign | `ntm.nota.sign(draft)` | The issuer signs the content as EIP-712 typed data. The digest is the `notaId`. |
| 4. Mint | `ntm.registry.mint(draft, signature)` | Runs the signed preflight, simulates, sends `mint`, and waits for the configured confirmations. |
| 5. Write | (inside `mint`) | Writes revision 0 of the container from the `NotaMinted` event and verifies it with the strict reader. |

```ts
const draft = await ntm.nota.compose({ type: "contract", chainName: "ethereum", chainId: 1, identifier: "0x...", alias: "vault.nota" });

const preflight = await ntm.registry.check(draft);
if (!preflight.readyToSign) throw new Error(`${preflight.ruleId}: ${preflight.message}`);

const fees = await ntm.registry.quoteMintFees(draft);   // { mintFee, aliasFee, total }
// The submitter must hold fees.total NOTA and have approved it to the registry.

const signature = await ntm.nota.sign(draft);
const { file, notaId, fileName } = await ntm.registry.mint(draft, signature);
```

Things to know:

- **Fees.** The registry collects `mintFee` (0 initially) and, when the mint binds a new alias, `aliasFee`, from the account that *submits* the transaction. Approve NOTA to the registry first; a missing allowance surfaces as a `ContractCallError` with `revertName: "ERC20InsufficientAllowance"` before anything is sent.
- **Relayed minting.** The submitter need not be the issuer. The record's owner is `issuer.account`, established by the signature. Pass the issuer's signature to a client whose signer is the relayer.
- **Succession.** Content is immutable. To change a name or description, mint a successor whose `supersedes` names the issuer's current file; `compose` fills that in.
- **Finality.** A file written before its mint is final can end up with a receipt that points at nothing. Set `confirmations` in `Notareum({...})` (default 1) to the depth you consider final on the registry chain.
- **Everything is public.** Content and metadata are published on-chain permanently. Revocation marks a record; it does not erase it.
- **Contract accounts.** `sign()` signs as an externally owned account. For a contract account, obtain its ERC-1271 signature and pass the bytes to `mint`.

### With wagmi, viem or a relayer

The flow's building blocks are exported without a provider, so an application can sign and send with whatever it already uses:

```ts
import { mintArguments, NotareumNotaRegistryABI } from "@notareum/sdk";

const draft = await ntm.nota.compose({ ...input, issuer: account });
const typed = await ntm.nota.typedData(draft);                 // { domain, types, primaryType, message }
const raw = await walletClient.signTypedData({ account, ...typed });
const signature = await ntm.nota.signatureFromWallet(raw, draft);

const hash = await walletClient.writeContract({
  address: registryAddress,
  abi: NotareumNotaRegistryABI,
  functionName: "mint",
  args: mintArguments(draft, signature),
});
const minted = await ntm.nota.fromTransaction(hash);           // waits, then writes the file
```

Fully offline equivalents are exported too: `composeNotaDraft`, `notaTypedData`, `signatureFromWallet`, `findNotaMintedLog`, `notaFileFromMintLog`.

## Reading a file

```ts
const { file, standing } = await ntm.nota.verify(bytes);
```

`verify` applies all five reader trust rules: strict parse; recompute `notaId`, `metadataHash` and `resourceId`; check the signature; check that the file's registry is one this client trusts; and confirm the record on-chain. An invalid file throws. Otherwise `standing.state` is one of:

| State | Meaning | Presentation |
| --- | --- | --- |
| `unconfirmed` | Well formed and signed, but the registry was not consulted. | "Not confirmed". Never as registered or verified, whatever the file's annexes say. |
| `registered` | The registry holds the record (`REGISTERED` or `PENDING`). | "Registered. Not socially verified." |
| `socially-verified` | Status `VERIFIED`. | "Socially verified", with `standing.level`. |
| `warning` | `DISPUTED`, `REVOKED`, `SUPERSEDED`, or expired. | A prominent warning. Not to be offered as a transaction destination without an explicit user override. |
| `invalid` | The registry has no matching record: the receipt is fabricated. | Refuse to load. |

`standing` also carries `controlProof` (`"self"`: the gate established that the issuer controls the resource; `"claimed"`: the issuer asserts it; show the two differently), `canonical`, `expired`, `supersededBy` and human-readable `notes`.

- `ntm.nota.read(bytes)` is the offline read (rules 1 to 3). Its result is always `unconfirmed`.
- A file that names a registry other than the configured one (or one listed in `trustedRegistries`) throws `UntrustedRegistryError`: a reader must not trust a registry merely because a file names it.
- `ntm.registry.reconstruct(notaId)` rebuilds a file from its `NotaMinted` event, byte for byte. A lost file can be recovered from the chain.

## Legacy v1.0 documents

A v1.0 `.nota` file is a JSON document. It is not a v1.1 file and must never be presented as registered or verified on the strength of its embedded `verification` block.

```ts
if (ntm.nota.isLegacy(bytes)) {
  const { draft, issues, notes } = ntm.nota.importLegacy(bytes);
  // notes: what was changed while mapping. issues: what stops the draft from being minted.
  if (issues.length === 0) await ntm.nota.mint(draft);   // signs as the issuer, then mints
}
```

## Sub-clients

| Client | Access | Description |
| --- | --- | --- |
| `nota` | `ntm.nota` | `.nota` files: `compose`, `typedData`, `sign`, `mint`, `create`, `fromTransaction`, `read`, `open`, `verify`, `importLegacy`. |
| `registry` | `ntm.registry` | `check`, `quoteMintFees`, `mint`, `getNota`, `getResource`, `headOf`, `canonicalOf`, `resolveAlias`, `aliasInfo`, `isLive`, `isVerifiable`, `revoke`, `reconstruct`, `listMinted`, resource types. |
| `verification` | `ntm.verification` | Social verification by `notaId`: `requestVerification`, `submitAttestation`, `getAttestations`, `getVerificationRequest`, fees and quorums. |
| `staking` | `ntm.staking` | `stake`, `requestUnstake`, `completeUnstake`, `claimRewards`, `getValidatorInfo`, `getUnbondingRequests`, `isValidator`. |
| `governance` | `ntm.governance` | veNOTA locks. Each lock is an NFT: `createLock`, `increaseLockAmount`, `extendLock`, `withdraw`, `getLock`, `getLocks`, `getVotingPower`, `getTotalVotingPower`. |
| `fee` | `ntm.fee` | Fee distribution: `getFeeConfig`, `getFeesCollected`, `getPendingReward`, `claimReward`. |

Each client can be instantiated directly:

```ts
import { RegistryClient } from "@notareum/sdk";
const registry = new RegistryClient(address, provider);
```

Write methods return the transaction hash. They simulate first, so a revert is reported before the wallet is asked to send. Omit the `signer` for read-only use; write methods then throw `SignerRequiredError`.

## Errors

| Error | When |
| --- | --- |
| `NotaConformanceError` | Content the gate would refuse, found locally. Carries `rule` (`G1` to `G9`, `T1` to `T6`, `SCHEMA`, ...) and `field`. |
| `ConformanceFailedError` | The gate or the registry refused a mint on-chain. Carries `rule` (1 to 13), `ruleId` and `requirement`. |
| `NotaContainerError` | The strict reader rejected a file. Carries `code`. |
| `UntrustedRegistryError` | A file names a registry that is not pinned. |
| `ContractCallError` | Any other failed call. Carries `revertName` and `revertArgs` when the revert is one of the protocol's custom errors, and the original error as `cause`. |
| `NotaNotFoundError` | No record or no `NotaMinted` event for a `notaId`. |
| `SignerRequiredError`, `ConfigurationError` | A write without a signer; a client used without what it needs. |

## ABIs

```ts
import { NotareumNotaRegistryABI, NotareumConformanceGateABI } from "@notareum/sdk";
```

`as const` ABIs for all nine contracts are exported: NotaRegistry, ConformanceGate, VerificationEngine, ValidatorStaking, SlashingManager, FeeManager, NOTAToken, VeNOTA, AccessManager.

## Migrating from 1.x

| 1.x | 2.x (protocol v1.1) |
| --- | --- |
| `ntm.nota.create(opts)` returned a `NotaBuilder`; `.sign()` used EIP-191; `.serialize()` returned JSON | `await ntm.nota.create(opts)` mints and returns `{ file: Uint8Array, notaId, ... }`. There is no unminted `.nota` file. |
| `ntm.nota.parse(json)`, `isValid`, `serialize` | `ntm.nota.read(bytes)` / `verify(bytes)`. For old JSON documents, `importLegacy`. |
| `registry.registerResource(type, chainId, identifier, proofHash, alias)` | Removed. Minting is registration. An alias is part of the content. |
| `registry.getResource(resourceId)` returned owner, alias, status | `registry.getNota(notaId)` returns the file's record; `getResource(resourceId)` returns type, chain, identifier and the canonical file. Both return `null` when there is nothing. |
| `registry.resolveAlias(alias)` returned a `resourceId` | Returns the `notaId` the alias currently points to. |
| `registry.revokeResource(resourceId)` | `registry.revoke(notaId)` |
| `verification.requestVerification(resourceId, level)`, `submitAttestation(resourceId, ok)` | Same calls, by `notaId`. |
| `VerificationStatus.UNVERIFIED` | `NotaStatus.REGISTERED`; `NotaStatus.SUPERSEDED` is new. |
| `staking.unstake()`, `claimStake()`, `getTierThreshold()`; `ValidatorTier.BRONZE...` | `requestUnstake(amount)`, `completeUnstake()`, `getTierMinimum()`; `StakingTier.BASIC...`. The 1.x names called functions the contract never had. |
| `governance.lock()`, `unlock()`, `getVotingPower(address)` as one call, `getTotalSupply()` | `createLock()`, `withdraw(tokenId)`, `getVotingPower(address)` summed over the account's lock NFTs, `getTotalVotingPower()`, `getLockCount()`. |
| `fee.getVerificationFee()`, `getAliasFee()`, `getDisputeBond()` | Prices live where they are charged: `registry.mintFee()` / `aliasFee()`, `verification.getVerificationFee(level)`. `fee` covers the fee manager's split and rewards. |
| `ContractAddresses` | Adds optional `conformanceGate`. |

## Bundled core and ABIs

The SDK vendors the reference implementation of the format (`@notareum/core`, not published separately) under `src/core/`, its tests under `test/core/`, and the contract ABIs under `src/abi/`. To refresh them from sibling checkouts of `core`, `protocol` and `contracts`:

```bash
npm run sync          # both
npm run sync -- core  # src/core, test/core
npm run sync -- abi   # src/abi, after `npx hardhat compile` in contracts/
```

Do not edit `src/core/`, `test/core/` or `src/abi/` by hand.

## Development

```bash
npm install
npm run lint       # tsc --noEmit
npm test           # vitest run
npm run build      # tsc -> dist/
```

Client tests run against a small JSON-RPC node (`test/helpers/fake-node.ts`) whose contracts answer through the real ABIs, so a client that calls a function the contracts do not have fails the suite.

## Versioning & Releases

Releases are automated by [semantic-release](https://semantic-release.gitbook.io) on every push to `main` (and `next` / `beta` / `alpha` for pre-releases). Versioning, changelog, git tag, GitHub release, and npm publish all derive from [Conventional Commits](https://www.conventionalcommits.org/):

| Commit type                | Release  |
| -------------------------- | -------- |
| `feat: ...`                | minor    |
| `fix:` / `perf:` / `revert:` / `refactor:` / `build:` | patch |
| `BREAKING CHANGE:` footer or `feat!:` / `fix!:` | major |
| `docs:` / `style:` / `test:` / `ci:` / `chore:` | no release |

The protocol v1.1 port changes the public API incompatibly, so it must land with a `BREAKING CHANGE:` footer (or `feat!:`), which releases it as the next major version.

Packages are published to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements) attestations. See [CHANGELOG.md](./CHANGELOG.md) for the release history.

### Required repository secrets

- `NPM_TOKEN` -- npm automation token with publish rights to `@notareum`.
- `GITHUB_TOKEN` -- provided automatically by GitHub Actions.

## Compatibility

| Component        | Version          |
| ---------------- | ---------------- |
| Protocol         | v1.1 (draft)     |
| Node.js          | >= 18            |
| TypeScript       | >= 5.0           |
| `ethers`         | ^6.13            |
| Module format    | ESM only         |

CommonJS consumers should use a bundler (Vite, Webpack, esbuild, tsup, etc.) or dynamic `import()`.

## Companion SDKs

- **Python:** [`notareum-py-sdk`](https://github.com/notareum/notareum-py-sdk)
- **Rust:**   [`notareum-rs-sdk`](https://github.com/notareum/notareum-rs-sdk)

At the time of writing these implement protocol v1.0.

## Links

- Website: <https://notareum.com>
- Docs:    <https://docs.notareum.com>
- Whitepaper: <https://notareum.com/whitepaper>
- Protocol spec: <https://github.com/notareum/protocol>
- Issues: <https://github.com/notareum/notareum-ts-sdk/issues>

## License

[MIT](./LICENSE) (c) Notareum Labs.
