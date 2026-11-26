/**
 * The Notareum contracts, modelled on a FakeNode for client tests.
 *
 * The models keep just enough state to answer the way the contracts do:
 * the registry and gate apply the mint rules (using the vendored core for
 * hashing and signature recovery), the engine counts attestations, and so
 * on. They are not a substitute for the Solidity; the point is that every
 * call crosses the real ABI in both directions.
 */

import { Interface, Wallet, getAddress } from "ethers";
import type { Result } from "ethers";
import {
  NotareumConformanceGateABI,
  NotareumFeeManagerABI,
  NotareumNOTATokenABI,
  NotareumNotaRegistryABI,
  NotareumValidatorStakingABI,
  NotareumVeNOTAABI,
  NotareumVerificationEngineABI,
} from "../../src/abi/index.js";
import {
  NOTA_ZERO_HASH,
  NotaConformanceError,
  NotaStatus,
  computeMetadataHash,
  computeNotaId,
  computeNotaResourceId,
  contentFromMintedStruct,
  encodeUtf8,
  hexToBytes,
  recoverNotaSigner,
  resolveResourceTypeId,
} from "../../src/core/index.js";
import type { MintedNotaStruct, NotaContent, RegistryDeployment } from "../../src/core/index.js";
import type { ContractAddresses } from "../../src/types.js";
import { CHAIN_ID, FakeNode, Revert } from "./fake-node.js";
import type { CallContext } from "./fake-node.js";

/** Hardhat's test account #0. Public: never use it for anything of value. */
export const ISSUER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const ISSUER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
/** Hardhat's test account #1. */
export const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
export const OTHER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

export const ADDRESSES = {
  accessManager: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  notaToken: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  veNota: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  validatorStaking: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  notaRegistry: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
  conformanceGate: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
  verificationEngine: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
  slashingManager: "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853",
  feeManager: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
} as const satisfies Required<ContractAddresses>;

export const REGISTRY: RegistryDeployment = { chainId: CHAIN_ID, address: ADDRESSES.notaRegistry };

const ZERO_ADDRESS = "0x" + "0".repeat(40);
const NOTA = 10n ** 18n;

interface Record_ {
  resourceId: string;
  issuer: string;
  metadataHash: string;
  supersedes: string;
  supersededBy: string;
  status: number;
  level: number;
  controlProof: number;
  ruleset: number;
  mintedAt: number;
  expiresAt: number;
  updatedAt: number;
}

interface Request {
  notaId: string;
  level: number;
  requester: string;
  feeDeposited: bigint;
  approvals: bigint;
  rejections: bigint;
  resolved: boolean;
  voted: Set<string>;
}

export interface Protocol {
  node: FakeNode;
  /** Registry records by `notaId`. Mutate to put a file in any state. */
  records: Map<string, Record_>;
  resources: Map<string, { resourceType: number; chainId: bigint; identifier: string; canonical: string }>;
  heads: Map<string, string>;
  aliases: Map<string, { resourceId: string; owner: string }>;
  requests: Map<bigint, Request>;
  /** NOTA allowances, keyed `owner:spender` in lowercase. */
  allowances: Map<string, bigint>;
  validators: Map<string, { stakedAmount: bigint; dailyVerifications: bigint; lastResetDay: bigint }>;
  unbonding: Map<string, Array<{ amount: bigint; releaseTime: bigint; claimed: boolean }>>;
  locks: Map<bigint, { owner: string; amount: bigint; lockStart: bigint; lockEnd: bigint }>;
  fees: { mintFee: bigint; aliasFee: bigint };
  approve(owner: string, spender: string, amount: bigint): void;
  /** A wallet connected to the node. */
  wallet(key?: string): Wallet;
}

const headKey = (resourceId: string, issuer: string): string => `${resourceId}:${issuer.toLowerCase()}`;

function conformanceFailed(rule: number): Revert {
  return new Revert(new Interface(NotareumConformanceGateABI).encodeErrorResult("ConformanceFailed", [rule]));
}

function ruleNumber(err: NotaConformanceError): number {
  if (/^G\d+$/.test(err.rule)) return Number(err.rule.slice(1));
  if (/^T\d$/.test(err.rule)) return 3;
  return 1;
}

export function deployProtocol(node = new FakeNode()): Protocol {
  const tokenInterface = new Interface(NotareumNOTATokenABI);
  const registryInterface = new Interface(NotareumNotaRegistryABI);
  const engineInterface = new Interface(NotareumVerificationEngineABI);
  const stakingInterface = new Interface(NotareumValidatorStakingABI);
  const veInterface = new Interface(NotareumVeNOTAABI);

  const protocol: Protocol = {
    node,
    records: new Map(),
    resources: new Map(),
    heads: new Map(),
    aliases: new Map(),
    requests: new Map(),
    allowances: new Map(),
    validators: new Map(),
    unbonding: new Map(),
    locks: new Map(),
    fees: { mintFee: 0n, aliasFee: 100n * NOTA },
    approve(owner, spender, amount) {
      this.allowances.set(`${owner.toLowerCase()}:${spender.toLowerCase()}`, amount);
    },
    wallet(key = ISSUER_KEY) {
      return new Wallet(key, node);
    },
  };

  /** Pulls NOTA the way SafeERC20.safeTransferFrom does, reverting with the token's error. */
  function pull(owner: string, spender: string, amount: bigint, mutating: boolean): void {
    if (amount === 0n) return;
    const key = `${owner.toLowerCase()}:${spender.toLowerCase()}`;
    const allowance = protocol.allowances.get(key) ?? 0n;
    if (allowance < amount) {
      throw new Revert(
        tokenInterface.encodeErrorResult("ERC20InsufficientAllowance", [spender, allowance, amount])
      );
    }
    if (mutating) protocol.allowances.set(key, allowance - amount);
  }

  // ---------------------------------------------------------------------
  // Registry and gate
  // ---------------------------------------------------------------------

  interface Evaluated {
    content: NotaContent;
    notaId: string;
    resourceId: string;
    controlProof: number;
    newAlias: boolean;
  }

  /** Gate rules in the contract's order: G1 to G8, G10 to G13, then G9. */
  function evaluate(struct: Result, metadataHex: string, signatureHex: string, timestamp: number): Evaluated {
    let content: NotaContent;
    try {
      content = contentFromMintedStruct(struct.toObject(true) as unknown as MintedNotaStruct);
    } catch (err) {
      if (err instanceof NotaConformanceError) throw conformanceFailed(ruleNumber(err));
      throw err;
    }
    const metadata = hexToBytes(metadataHex);
    if (computeMetadataHash(metadata) !== content.metadataHash) throw conformanceFailed(7);
    if (
      content.issuedAt + 86_400 < timestamp ||
      content.issuedAt > timestamp + 900 ||
      (content.expiresAt !== 0 && content.expiresAt <= timestamp)
    ) {
      throw conformanceFailed(8);
    }
    const notaId = computeNotaId(content, REGISTRY);
    const resourceId = computeNotaResourceId(content);
    const issuer = content.issuer.account;

    if (protocol.records.has(notaId)) throw conformanceFailed(10);
    const head = protocol.heads.get(headKey(resourceId, issuer)) ?? NOTA_ZERO_HASH;
    if (content.supersedes !== head) throw conformanceFailed(11);
    if (head !== NOTA_ZERO_HASH) {
      const status = protocol.records.get(head)!.status;
      if (status !== NotaStatus.REGISTERED && status !== NotaStatus.VERIFIED) throw conformanceFailed(11);
    }
    let newAlias = false;
    if (content.resource.alias !== "") {
      const binding = protocol.aliases.get(content.resource.alias);
      if (binding === undefined) newAlias = true;
      else if (binding.resourceId !== resourceId || binding.owner !== issuer) throw conformanceFailed(13);
    }

    const signer = (() => {
      try {
        return recoverNotaSigner(notaId, signatureHex);
      } catch {
        return null;
      }
    })();
    if (signer !== issuer) throw conformanceFailed(9);

    const self =
      content.type === "address" && content.chain.chainId > 0 && content.resource.identifier === issuer;
    return { content, notaId, resourceId, controlProof: self ? 1 : 0, newAlias };
  }

  function recordTuple(notaId: string): unknown[] {
    const r = protocol.records.get(notaId);
    if (r === undefined) {
      return [NOTA_ZERO_HASH, ZERO_ADDRESS, NOTA_ZERO_HASH, NOTA_ZERO_HASH, NOTA_ZERO_HASH, 0, 0, 0, 0, 0, 0, 0];
    }
    return [
      r.resourceId,
      r.issuer,
      r.metadataHash,
      r.supersedes,
      r.supersededBy,
      r.status,
      r.level,
      r.controlProof,
      r.ruleset,
      r.mintedAt,
      r.expiresAt,
      r.updatedAt,
    ];
  }

  function isExpired(r: Record_, timestamp: number): boolean {
    return r.expiresAt !== 0 && timestamp > r.expiresAt;
  }

  function canonicalOf(resourceId: string, timestamp: number): string {
    const holder = protocol.resources.get(resourceId)?.canonical ?? NOTA_ZERO_HASH;
    if (holder === NOTA_ZERO_HASH) return holder;
    const r = protocol.records.get(holder)!;
    return r.status === NotaStatus.VERIFIED && !isExpired(r, timestamp) ? holder : NOTA_ZERO_HASH;
  }

  function isVerifiable(notaId: string, timestamp: number): boolean {
    const r = protocol.records.get(notaId);
    if (r === undefined || r.status !== NotaStatus.REGISTERED || isExpired(r, timestamp)) return false;
    return protocol.heads.get(headKey(r.resourceId, r.issuer)) === notaId;
  }

  function requireNota(notaId: string): Record_ {
    const r = protocol.records.get(notaId);
    if (r === undefined) throw new Revert(registryInterface.encodeErrorResult("NotaNotFound", [notaId]));
    return r;
  }

  node.deploy(ADDRESSES.conformanceGate, NotareumConformanceGateABI, {
    RULESET: () => 1,
    check: (args, context) => {
      const result = evaluate(args[0] as Result, args[1] as string, args[2] as string, context.timestamp);
      return [result.notaId, result.resourceId, result.controlProof];
    },
  });

  node.deploy(ADDRESSES.notaRegistry, NotareumNotaRegistryABI, {
    conformanceGate: () => ADDRESSES.conformanceGate,
    ruleset: () => 1,
    mintFee: () => protocol.fees.mintFee,
    aliasFee: () => protocol.fees.aliasFee,
    mint: (args, context) => {
      const struct = args[0] as Result;
      const result = evaluate(struct, args[1] as string, args[2] as string, context.timestamp);
      const { content, notaId, resourceId } = result;
      const issuer = content.issuer.account;
      const fees = protocol.fees.mintFee + (result.newAlias ? protocol.fees.aliasFee : 0n);
      pull(context.from, ADDRESSES.notaRegistry, fees, context.mutating);
      if (!context.mutating) return notaId;

      if (!protocol.resources.has(resourceId)) {
        protocol.resources.set(resourceId, {
          resourceType: resolveResourceTypeId(content.type)!,
          chainId: BigInt(content.chain.chainId),
          identifier: content.resource.identifier,
          canonical: NOTA_ZERO_HASH,
        });
      }
      const previous = protocol.heads.get(headKey(resourceId, issuer));
      if (previous !== undefined) {
        const predecessor = protocol.records.get(previous)!;
        predecessor.supersededBy = notaId;
        if (predecessor.status === NotaStatus.REGISTERED) predecessor.status = NotaStatus.SUPERSEDED;
      }
      protocol.records.set(notaId, {
        resourceId,
        issuer,
        metadataHash: content.metadataHash,
        supersedes: content.supersedes,
        supersededBy: NOTA_ZERO_HASH,
        status: NotaStatus.REGISTERED,
        level: 0,
        controlProof: result.controlProof,
        ruleset: 1,
        mintedAt: context.timestamp,
        expiresAt: content.expiresAt,
        updatedAt: context.timestamp,
      });
      protocol.heads.set(headKey(resourceId, issuer), notaId);
      if (result.newAlias) protocol.aliases.set(content.resource.alias, { resourceId, owner: issuer });
      context.emit("NotaMinted", [notaId, resourceId, issuer, 1, result.controlProof, struct, args[1], args[2]]);
      return notaId;
    },
    revoke: (args, context) => {
      const notaId = args[0] as string;
      const r = requireNota(notaId);
      if (r.issuer !== context.from) {
        throw new Revert(registryInterface.encodeErrorResult("NotIssuer", [notaId, context.from]));
      }
      if (r.status !== NotaStatus.REGISTERED && r.status !== NotaStatus.VERIFIED) {
        throw new Revert(
          registryInterface.encodeErrorResult("InvalidStatusTransition", [notaId, r.status, NotaStatus.REVOKED])
        );
      }
      if (context.mutating) {
        r.status = NotaStatus.REVOKED;
        if (protocol.heads.get(headKey(r.resourceId, r.issuer)) === notaId) {
          protocol.heads.delete(headKey(r.resourceId, r.issuer));
        }
        context.emit("NotaRevoked", [notaId, r.issuer]);
      }
    },
    getNota: (args) => recordTuple(args[0] as string),
    getResource: (args, context) => {
      const id = args[0] as string;
      const r = protocol.resources.get(id);
      if (r === undefined) return [0, 0, "0x", NOTA_ZERO_HASH];
      return [r.resourceType, r.chainId, encodeUtf8(r.identifier), canonicalOf(id, context.timestamp)];
    },
    headOf: (args) => protocol.heads.get(headKey(args[0] as string, args[1] as string)) ?? NOTA_ZERO_HASH,
    canonicalOf: (args, context) => canonicalOf(args[0] as string, context.timestamp),
    isLive: (args, context) => {
      const r = protocol.records.get(args[0] as string);
      if (r === undefined || isExpired(r, context.timestamp)) return false;
      return r.status !== NotaStatus.REVOKED && r.status !== NotaStatus.SUPERSEDED;
    },
    isVerifiable: (args, context) => isVerifiable(args[0] as string, context.timestamp),
    canonicalHeldByOther: () => false,
    resolveAlias: (args) => {
      const binding = protocol.aliases.get(args[0] as string);
      if (binding === undefined) return NOTA_ZERO_HASH;
      return protocol.heads.get(headKey(binding.resourceId, binding.owner)) ?? NOTA_ZERO_HASH;
    },
    aliasInfo: (args) => {
      const binding = protocol.aliases.get(args[0] as string);
      return binding === undefined ? [NOTA_ZERO_HASH, ZERO_ADDRESS] : [binding.resourceId, binding.owner];
    },
    hashNota: (args) =>
      computeNotaId(contentFromMintedStruct((args[0] as Result).toObject(true) as unknown as MintedNotaStruct), REGISTRY),
    computeResourceId: (args) =>
      computeNotaResourceId({
        type: ["address", "transaction", "contract", "ipfs", "nft", "metadata"][Number(args[0])],
        chain: { name: "", chainId: Number(args[1]), network: "" },
        resource: {
          identifier: new TextDecoder().decode(hexToBytes(args[2] as string)),
          name: "",
          alias: "",
          description: "",
        },
      }),
    validResourceTypes: (args) => Number(args[0]) <= 5,
    resourceTypeNames: (args) =>
      ["address", "transaction", "contract", "ipfs", "nft", "metadata"][Number(args[0])] ?? "",
    addResourceType: () => undefined,
    removeResourceType: () => undefined,
  });

  // ---------------------------------------------------------------------
  // Verification engine
  // ---------------------------------------------------------------------

  const FEES = [100n * NOTA, 500n * NOTA, 2000n * NOTA];
  const QUORUMS = [3n, 7n, 15n];
  const active = new Map<string, bigint>();
  let nextRequestId = 0n;

  node.deploy(ADDRESSES.verificationEngine, NotareumVerificationEngineABI, {
    FEE_BASIC: () => FEES[0],
    FEE_ENHANCED: () => FEES[1],
    FEE_INSTITUTIONAL: () => FEES[2],
    QUORUM_BASIC: () => QUORUMS[0],
    QUORUM_ENHANCED: () => QUORUMS[1],
    QUORUM_INSTITUTIONAL: () => QUORUMS[2],
    requestVerification: (args, context) => {
      const notaId = args[0] as string;
      const level = Number(args[1]);
      if (active.has(notaId)) {
        throw new Revert(engineInterface.encodeErrorResult("AlreadyPendingVerification", [notaId]));
      }
      if (!isVerifiable(notaId, context.timestamp)) {
        throw new Revert(engineInterface.encodeErrorResult("NotVerifiable", [notaId]));
      }
      pull(context.from, ADDRESSES.verificationEngine, FEES[level], context.mutating);
      const requestId = nextRequestId + 1n;
      if (context.mutating) {
        nextRequestId = requestId;
        protocol.requests.set(requestId, {
          notaId,
          level,
          requester: context.from,
          feeDeposited: FEES[level],
          approvals: 0n,
          rejections: 0n,
          resolved: false,
          voted: new Set(),
        });
        active.set(notaId, requestId);
        protocol.records.get(notaId)!.status = NotaStatus.PENDING;
        context.emit("VerificationRequested", [requestId, notaId, level, context.from, FEES[level]]);
      }
      return requestId;
    },
    submitAttestation: (args, context) => {
      const notaId = args[0] as string;
      const approved = args[1] as boolean;
      const validator = protocol.validators.get(context.from.toLowerCase());
      if (validator === undefined || validator.stakedAmount < 10_000n * NOTA) {
        throw new Revert(engineInterface.encodeErrorResult("NotAValidator", [context.from]));
      }
      const requestId = active.get(notaId);
      if (requestId === undefined) throw new Revert(engineInterface.encodeErrorResult("RequestNotFound", [0]));
      const request = protocol.requests.get(requestId)!;
      if (request.voted.has(context.from)) {
        throw new Revert(engineInterface.encodeErrorResult("AlreadyVoted", [requestId, context.from]));
      }
      if (!context.mutating) return;
      request.voted.add(context.from);
      if (approved) request.approvals += 1n;
      else request.rejections += 1n;
      context.emit("AttestationSubmitted", [requestId, context.from, approved]);
      if (request.approvals + request.rejections >= QUORUMS[request.level]) {
        const verified = request.approvals * 10_000n >= 6_700n * (request.approvals + request.rejections);
        request.resolved = true;
        active.delete(notaId);
        const record = protocol.records.get(notaId)!;
        record.status = verified ? NotaStatus.VERIFIED : NotaStatus.REGISTERED;
        record.level = request.level;
        if (verified) protocol.resources.get(record.resourceId)!.canonical = notaId;
        context.emit("VerificationResolved", [requestId, notaId, verified, request.approvals, request.rejections]);
      }
    },
    getAttestations: (args) => {
      const requestId = active.get(args[0] as string);
      if (requestId === undefined) return [0, 0, 0, false];
      const r = protocol.requests.get(requestId)!;
      return [requestId, r.approvals, r.rejections, r.resolved];
    },
    getRequest: (args) => {
      const r = protocol.requests.get(BigInt(args[0] as bigint));
      if (r === undefined) return [NOTA_ZERO_HASH, 0, ZERO_ADDRESS, 0, 0, 0, false];
      return [r.notaId, r.level, r.requester, r.feeDeposited, r.approvals, r.rejections, r.resolved];
    },
  });

  // ---------------------------------------------------------------------
  // Validator staking
  // ---------------------------------------------------------------------

  const tierOf = (amount: bigint): number =>
    amount >= 1_000_000n * NOTA ? 4 : amount >= 250_000n * NOTA ? 3 : amount >= 50_000n * NOTA ? 2 : amount >= 10_000n * NOTA ? 1 : 0;

  node.deploy(ADDRESSES.validatorStaking, NotareumValidatorStakingABI, {
    stake: (args, context) => {
      const amount = BigInt(args[0] as bigint);
      const key = context.from.toLowerCase();
      const current = protocol.validators.get(key)?.stakedAmount ?? 0n;
      if (amount === 0n) throw new Revert(stakingInterface.encodeErrorResult("ZeroAmount", []));
      if (current + amount < 10_000n * NOTA) {
        throw new Revert(
          stakingInterface.encodeErrorResult("BelowMinimumStake", [current + amount, 10_000n * NOTA])
        );
      }
      pull(context.from, ADDRESSES.validatorStaking, amount, context.mutating);
      if (context.mutating) {
        protocol.validators.set(key, { stakedAmount: current + amount, dailyVerifications: 0n, lastResetDay: 0n });
      }
    },
    requestUnstake: (args, context) => {
      const amount = BigInt(args[0] as bigint);
      const key = context.from.toLowerCase();
      const validator = protocol.validators.get(key);
      if (validator === undefined || validator.stakedAmount === 0n) {
        throw new Revert(stakingInterface.encodeErrorResult("NotAValidator", [context.from]));
      }
      if (amount > validator.stakedAmount) {
        throw new Revert(stakingInterface.encodeErrorResult("InsufficientStake", [amount, validator.stakedAmount]));
      }
      if (context.mutating) {
        validator.stakedAmount -= amount;
        const list = protocol.unbonding.get(key) ?? [];
        list.push({ amount, releaseTime: BigInt(context.timestamp + 14 * 86_400), claimed: false });
        protocol.unbonding.set(key, list);
      }
    },
    completeUnstake: (_args, context) => {
      const list = protocol.unbonding.get(context.from.toLowerCase()) ?? [];
      const ready = list.filter((r) => !r.claimed && BigInt(context.timestamp) >= r.releaseTime);
      if (ready.length === 0) throw new Revert(stakingInterface.encodeErrorResult("NothingToClaim", []));
      if (context.mutating) for (const r of ready) r.claimed = true;
    },
    claimRewards: () => {
      throw new Revert(stakingInterface.encodeErrorResult("NothingToClaim", []));
    },
    getValidatorInfo: (args) => {
      const v = protocol.validators.get((args[0] as string).toLowerCase());
      const staked = v?.stakedAmount ?? 0n;
      return [staked, tierOf(staked), 0, 0, 0, 0, v?.dailyVerifications ?? 0n, v?.lastResetDay ?? 0n];
    },
    isValidator: (args) =>
      (protocol.validators.get((args[0] as string).toLowerCase())?.stakedAmount ?? 0n) >= 10_000n * NOTA,
    getUnbondingRequests: (args) =>
      (protocol.unbonding.get((args[0] as string).toLowerCase()) ?? []).map((r) => [r.amount, r.releaseTime, r.claimed]),
    slashRateForTier: (args) => [2500n, 2500n, 3500n, 5000n, 7500n][Number(args[0])],
  });

  // ---------------------------------------------------------------------
  // veNOTA
  // ---------------------------------------------------------------------

  let nextTokenId = 1n;
  const MAX_DURATION = 1461n * 86_400n;
  const lockOf = (tokenId: bigint) => protocol.locks.get(tokenId);
  const power = (tokenId: bigint, timestamp: number): bigint => {
    const lock = lockOf(tokenId);
    if (lock === undefined || lock.lockEnd <= BigInt(timestamp)) return 0n;
    return (lock.amount * (lock.lockEnd - BigInt(timestamp)) * 10n) / MAX_DURATION;
  };
  const owned = (owner: string): bigint[] =>
    [...protocol.locks.entries()].filter(([, l]) => l.owner === getAddress(owner)).map(([id]) => id);
  const requireOwner = (tokenId: bigint, caller: string): void => {
    if (lockOf(tokenId)?.owner !== caller) {
      throw new Revert(veInterface.encodeErrorResult("NotLockOwner", [tokenId, caller]));
    }
  };

  node.deploy(ADDRESSES.veNota, NotareumVeNOTAABI, {
    createLock: (args, context) => {
      const amount = BigInt(args[0] as bigint);
      const duration = BigInt(args[1] as bigint);
      if (duration < 91n * 86_400n) {
        throw new Revert(veInterface.encodeErrorResult("DurationTooShort", [duration, 91n * 86_400n]));
      }
      pull(context.from, ADDRESSES.veNota, amount, context.mutating);
      const tokenId = nextTokenId;
      if (context.mutating) {
        nextTokenId += 1n;
        const lockEnd = BigInt(context.timestamp) + duration;
        protocol.locks.set(tokenId, { owner: context.from, amount, lockStart: BigInt(context.timestamp), lockEnd });
        context.emit("LockCreated", [tokenId, context.from, amount, lockEnd]);
      }
      return tokenId;
    },
    increaseLockAmount: (args, context) => {
      const tokenId = BigInt(args[0] as bigint);
      requireOwner(tokenId, context.from);
      pull(context.from, ADDRESSES.veNota, BigInt(args[1] as bigint), context.mutating);
      if (context.mutating) lockOf(tokenId)!.amount += BigInt(args[1] as bigint);
    },
    extendLock: (args, context) => {
      const tokenId = BigInt(args[0] as bigint);
      requireOwner(tokenId, context.from);
      const lock = lockOf(tokenId)!;
      const newEnd = BigInt(context.timestamp) + BigInt(args[1] as bigint);
      if (newEnd <= lock.lockEnd) {
        throw new Revert(veInterface.encodeErrorResult("NewDurationNotLonger", [newEnd, lock.lockEnd]));
      }
      if (context.mutating) {
        lock.lockStart = BigInt(context.timestamp);
        lock.lockEnd = newEnd;
      }
    },
    withdraw: (args, context) => {
      const tokenId = BigInt(args[0] as bigint);
      requireOwner(tokenId, context.from);
      const lock = lockOf(tokenId)!;
      if (BigInt(context.timestamp) < lock.lockEnd) {
        throw new Revert(veInterface.encodeErrorResult("LockNotExpired", [tokenId, lock.lockEnd, context.timestamp]));
      }
      if (context.mutating) protocol.locks.delete(tokenId);
    },
    lockInfo: (args) => {
      const lock = lockOf(BigInt(args[0] as bigint));
      return lock === undefined ? [0, 0, 0] : [lock.amount, lock.lockStart, lock.lockEnd];
    },
    votingPower: (args, context) => power(BigInt(args[0] as bigint), context.timestamp),
    totalVotingPower: (_args, context) =>
      [...protocol.locks.keys()].reduce((total, id) => total + power(id, context.timestamp), 0n),
    balanceOf: (args) => owned(args[0] as string).length,
    tokenOfOwnerByIndex: (args) => owned(args[0] as string)[Number(args[1])],
    ownerOf: (args) => {
      const lock = lockOf(BigInt(args[0] as bigint));
      if (lock === undefined) {
        throw new Revert(veInterface.encodeErrorResult("ERC721NonexistentToken", [args[0]]));
      }
      return lock.owner;
    },
    totalSupply: () => protocol.locks.size,
  });

  // ---------------------------------------------------------------------
  // Fee manager
  // ---------------------------------------------------------------------

  const feeState = { burnRate: 1000n, treasuryRate: 2000n };
  const feeInterface = new Interface(NotareumFeeManagerABI);
  node.deploy(ADDRESSES.feeManager, NotareumFeeManagerABI, {
    burnRate: () => feeState.burnRate,
    treasuryRate: () => feeState.treasuryRate,
    treasury: () => ISSUER,
    burnAddress: () => "0x000000000000000000000000000000000000dEaD",
    pendingFees: () => 42n * NOTA,
    feesCollectedByType: (args) => [7n, 8n, 9n][Number(args[0])] * NOTA,
    pendingReward: () => 5n * NOTA,
    claimReward: () => undefined,
    setBurnRate: (args, context) => {
      const rate = BigInt(args[0] as bigint);
      if (rate > 5000n) throw new Revert(feeInterface.encodeErrorResult("RateExceedsMax", [rate, 5000n]));
      if (context.mutating) feeState.burnRate = rate;
    },
    setTreasuryRate: (args, context) => {
      if (context.mutating) feeState.treasuryRate = BigInt(args[0] as bigint);
    },
  });

  return protocol;
}

export type { CallContext };
