## [1.1.0](https://github.com/notareum/notareum-ts-sdk/compare/v1.0.0...v1.1.0) (2026-11-26)

### ⚠ BREAKING CHANGES

* **sdk:** VerificationStatus, NotaBuilder, ValidatorTier and the
v1.0 NotaFile types are no longer exported. Use NotaStatus (REGISTERED
replaces UNVERIFIED, SUPERSEDED is new), StakingTier and the v1.1 types.
* **fee:** getVerificationFee, getAliasFee, getDisputeBond,
getFeeCollector, setVerificationFee and setAliasFee are removed. Prices
are read where they are charged: RegistryClient.mintFee()/aliasFee()
and VerificationClient.getVerificationFee(). FeeConfig has new fields.
* **governance:** lock() and unlock() are replaced by createLock() and
withdraw(tokenId). getTotalSupply() is replaced by getTotalVotingPower()
and getLockCount(). VeNOTALock carries tokenId, lockStart and lockEnd.
* **staking:** unstake() and claimStake() are replaced by
requestUnstake(amount) and completeUnstake(); getTierThreshold() by
getTierMinimum(). ValidatorTier (BRONZE..PLATINUM) is replaced by
StakingTier (BASIC..INSTITUTIONAL), and ValidatorInfo has the contract's
fields.
* **nota:** NotaBuilder, parse, validate, isValid and serialize
are removed. create() is asynchronous, mints, and returns the file as
bytes; there is no unminted .nota file.
* **verification:** verification methods take a notaId where they took a
resourceId, and VerificationRequest carries notaId and requestId.
* **registry:** registerResource and revokeResource are removed;
minting is registration. getResource returns the v1.1 resource (type,
chain, identifier, canonical file) or null, and resolveAlias returns a
notaId instead of a resourceId.
* **abi:** the registry ABI no longer contains register,
updateResource, registerAlias or revokeResource, and the verification
engine ABI is keyed by notaId instead of resourceId.
* **core:** a .nota file is a binary container, not JSON. The v1.0
builder, parser, validator and EIP-191 signer are no longer the core
API; they remain only under the legacy namespace.

### Features

* **abi:** regenerate ABIs from the v1.1 contracts ([6839c9c](https://github.com/notareum/notareum-ts-sdk/commit/6839c9cc03b4e1e3da14f507907c198403ae7c4c))
* **clients:** decode protocol reverts across contracts ([8cce611](https://github.com/notareum/notareum-ts-sdk/commit/8cce611d35db73035f7695b3b75354f37a5da2bc))
* **core:** vendor @notareum/core for protocol v1.1 ([4c2e8cd](https://github.com/notareum/notareum-ts-sdk/commit/4c2e8cd2e8d831788524a9f434b97a1f1363ee07))
* **errors:** add conformance, not-found and untrusted-registry errors ([28d4559](https://github.com/notareum/notareum-ts-sdk/commit/28d4559f945d0c7305b2625e6171d906b9a88a47))
* **mint:** add provider-free mint helpers ([1626864](https://github.com/notareum/notareum-ts-sdk/commit/16268642c64cbd28878124a242420bb227cf507d))
* **nota:** create .nota files by minting and verify them on read ([f0d8aba](https://github.com/notareum/notareum-ts-sdk/commit/f0d8abab5f76c9ea7a0ed1e2a7818adc72492845))
* **reader:** derive the state a reader may present ([d6c55c1](https://github.com/notareum/notareum-ts-sdk/commit/d6c55c1931f377d669dd5c3052e37e15539fe3d9))
* **registry:** mint and read v1.1 file records ([1cb08d1](https://github.com/notareum/notareum-ts-sdk/commit/1cb08d1e5a3901dc4feed0009070397b64f7e77a))
* **sdk:** wire the v1.1 clients and public exports ([1c7786d](https://github.com/notareum/notareum-ts-sdk/commit/1c7786dbd8bc13131376d68b2c17e5a44c9c2783))
* **types:** add v1.1 record, preflight and mint result types ([fbfa4d1](https://github.com/notareum/notareum-ts-sdk/commit/fbfa4d136d2585a9d4d8962e0e122036daf112a8))
* **verification:** key requests and attestations by notaId ([7998645](https://github.com/notareum/notareum-ts-sdk/commit/7998645911c6ca09517741b8fd52b9104dcb9c2b))

### Bug Fixes

* **fee:** read the fee manager's actual interface ([2610d5d](https://github.com/notareum/notareum-ts-sdk/commit/2610d5d01d1502a145b3632b8d31b046bc3b6167))
* **governance:** treat veNOTA locks as NFTs ([febceb8](https://github.com/notareum/notareum-ts-sdk/commit/febceb87c939321918b5804ad7d713a8a7737ad7))
* **staking:** call the functions the staking contract has ([5a854d7](https://github.com/notareum/notareum-ts-sdk/commit/5a854d79965cd899e74495aa4b928b56a40d6871))

### Build

* **deps:** require ethers ^6.13.4 ([3c591e5](https://github.com/notareum/notareum-ts-sdk/commit/3c591e5db0a30d30fb5c25ccd292326290f77954))

## 1.0.0 (2026-04-27)

### Features

* initial @notareum/sdk v1.0.0 ([f14239c](https://github.com/notareum/notareum-ts-sdk/commit/f14239c884b09e2003981b560b591f30342b3a0a))

### Refactors

* bundle core into SDK ([18d3b20](https://github.com/notareum/notareum-ts-sdk/commit/18d3b20e0e5807276cf74636168f4e90e0853b54))
* move client files into src/clients/ ([b3fd4ff](https://github.com/notareum/notareum-ts-sdk/commit/b3fd4ffd560733b5d05110e09e31c110a99d2b41))
