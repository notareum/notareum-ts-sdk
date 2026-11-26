/**
 * RegistryClient -- wraps NotareumNotaRegistry and its Conformance Gate (v1.1).
 *
 * In v1.1 the registry holds one record per minted `.nota` file, keyed by
 * `notaId`. A file is created by `mint`, which passes its content through the
 * gate; there is no separate registration step.
 *
 * @license MIT
 * @author Notareum Labs
 */

import { getAddress, isHexString, keccak256, solidityPacked } from "ethers";
import type { Contract, Log, Provider, Signer, TransactionReceipt } from "ethers";
import { NotareumConformanceGateABI, NotareumNotaRegistryABI } from "../abi/index.js";
import {
  computeNotaId,
  computeNotaResourceId,
  controlProofName,
  decodeUtf8,
  encodeUtf8,
  hexToBytes,
  readNota,
  resolveResourceTypeString,
} from "../core/index.js";
import type { NotaContent, NotaDraft, NotaSignature, RegistryDeployment } from "../core/index.js";
import { ConformanceFailedError, NotaNotFoundError, SignerRequiredError } from "../errors.js";
import { callError, decodeRevert, protocolContract } from "../internal/calls.js";
import {
  GATE_RULES,
  NOTA_MINTED_TOPIC,
  describeGateRule,
  findNotaMintedLog,
  mintArguments,
  notaFileFromMintLog,
  suggestNotaFileName,
  summarizeNotaMintedLog,
  toNotaStruct,
} from "../mint.js";
import type {
  AliasBinding,
  MintFees,
  MintResult,
  MintedNota,
  NotaRecord,
  PreflightResult,
  ResourceRecord,
} from "../types.js";

export interface RegistryClientOptions {
  /** The Conformance Gate. When omitted it is read from the registry. */
  conformanceGate?: string;
  /** Confirmations to wait for before a mint is treated as final. Default 1. */
  confirmations?: number;
  /** Chain ID of the registry chain. When omitted it is read from the provider. */
  chainId?: number;
  /** Milliseconds between checks while a mint is waiting to confirm. Default 1000. */
  pollingInterval?: number;
}

export interface MintOptions {
  /** Overrides the client's confirmation depth for this mint. */
  confirmations?: number;
  /** Give up waiting for the mint to confirm after this many milliseconds. Default: wait indefinitely. */
  timeout?: number;
}

export interface LogRange {
  /** First block to search. Default 0; pass the registry's deployment block on public RPC endpoints. */
  fromBlock?: number | bigint;
  /** Last block to search. Default `"latest"`. */
  toBlock?: number | bigint | "latest";
}

function requireBytes32(value: string, name: string): string {
  if (!isHexString(value, 32)) throw new TypeError(`${name} must be a 32-byte hex value`);
  return value.toLowerCase();
}

export class RegistryClient {
  /** EIP-55 address of the registry. */
  public readonly address: string;
  private readonly provider: Provider;
  private readonly signer: Signer | undefined;
  private readonly read: Contract;
  private readonly write: Contract | undefined;
  private readonly options: RegistryClientOptions;
  private cachedDeployment: RegistryDeployment | undefined;

  constructor(address: string, provider: Provider, signer?: Signer, options: RegistryClientOptions = {}) {
    this.address = getAddress(address);
    this.provider = provider;
    this.signer = signer;
    this.options = options;
    this.read = protocolContract(this.address, NotareumNotaRegistryABI, provider);
    this.write = signer ? protocolContract(this.address, NotareumNotaRegistryABI, signer) : undefined;
  }

  // -------------------------------------------------------------------------
  // Deployment
  // -------------------------------------------------------------------------

  /**
   * This registry deployment: the EIP-712 domain content is signed under, and
   * the one entry on this client's pinned list of canonical registries.
   */
  async deployment(): Promise<RegistryDeployment> {
    if (this.cachedDeployment === undefined) {
      const chainId = this.options.chainId ?? Number((await this.provider.getNetwork()).chainId);
      this.cachedDeployment = { chainId, address: this.address };
    }
    return this.cachedDeployment;
  }

  /** Address of the Conformance Gate mints currently pass through. */
  async conformanceGate(): Promise<string> {
    if (this.options.conformanceGate) return getAddress(this.options.conformanceGate);
    try {
      return getAddress((await this.read.conformanceGate()) as string);
    } catch (err) {
      throw callError("conformanceGate", err);
    }
  }

  /** `RULESET` of the current gate, stored in each record it admits. */
  async ruleset(): Promise<number> {
    try {
      return Number(await this.read.ruleset());
    } catch (err) {
      throw callError("ruleset", err);
    }
  }

  /**
   * The registry chain's clock in Unix seconds: the time the next block is
   * expected to carry. The gate compares `issuedAt` and `expiresAt` with this
   * clock, not the local one, and on a development node the two can be days
   * apart.
   */
  async chainTime(): Promise<number> {
    for (const tag of ["pending", "latest"] as const) {
      try {
        const block = await this.provider.getBlock(tag);
        if (block !== null) return block.timestamp;
      } catch {
        /* this endpoint does not serve the tag; try the next */
      }
    }
    return Math.floor(Date.now() / 1000);
  }

  /**
   * True when the account has code on the registry chain. The gate checks a
   * contract account's signature through ERC-1271, an externally owned
   * account's by ECDSA recovery.
   */
  async isContractAccount(account: string): Promise<boolean> {
    try {
      return (await this.provider.getCode(getAddress(account))) !== "0x";
    } catch (err) {
      throw callError("getCode", err);
    }
  }

  // -------------------------------------------------------------------------
  // Minting
  // -------------------------------------------------------------------------

  /**
   * Preflight: runs the gate's `check()` as a read call, at no cost.
   *
   * Without a signature, a result with `readyToSign` means the content passed
   * every rule but the signature rule, which the gate evaluates last. With a
   * signature, `ok` means the mint will be admitted.
   */
  async check(draft: NotaDraft, signature?: NotaSignature | string): Promise<PreflightResult> {
    const registry = await this.deployment();
    const notaId = computeNotaId(draft.content, registry);
    const resourceId = computeNotaResourceId(draft.content);
    const args = mintArguments(draft, signature);
    const gate = protocolContract(await this.conformanceGate(), NotareumConformanceGateABI, this.provider);
    try {
      const result = await gate.check.staticCall(...args);
      return {
        ok: true,
        readyToSign: true,
        rule: null,
        ruleId: null,
        message: null,
        notaId,
        resourceId,
        controlProof: controlProofName(result.controlProof as bigint),
      };
    } catch (err) {
      const revert = decodeRevert(err);
      if (revert === null || revert.name !== "ConformanceFailed") throw callError("check", err);
      const rule = Number(revert.args[0]);
      return {
        ok: false,
        readyToSign: rule === 9,
        rule,
        ruleId: GATE_RULES[rule]?.id ?? `G${rule}`,
        message: describeGateRule(rule),
        notaId,
        resourceId,
        controlProof: null,
      };
    }
  }

  /**
   * The fees the registry will collect from the submitter of this mint:
   * `mintFee`, plus `aliasFee` when the content carries an alias that is not
   * bound yet. The submitter must hold `total` NOTA and have approved it to
   * the registry.
   */
  async quoteMintFees(draft: NotaDraft): Promise<MintFees> {
    try {
      const alias = draft.content.resource.alias;
      const [mintFee, aliasFeeRate, binding] = await Promise.all([
        this.read.mintFee() as Promise<bigint>,
        this.read.aliasFee() as Promise<bigint>,
        alias === "" ? Promise.resolve(null) : this.read.aliasInfo(alias),
      ]);
      const newAlias = binding !== null && /^0x0{40}$/.test(binding.owner as string);
      const aliasFee = newAlias ? BigInt(aliasFeeRate) : 0n;
      return { mintFee: BigInt(mintFee), aliasFee, total: BigInt(mintFee) + aliasFee };
    } catch (err) {
      throw callError("quoteMintFees", err);
    }
  }

  /**
   * Mints a `.nota` file and returns it.
   *
   * Runs the signed preflight, simulates the transaction (so a missing NOTA
   * allowance for the fees is reported before anything is sent), sends
   * `mint(nota, metadata, signature)`, waits for the configured number of
   * confirmations, and writes revision 0 of the container from the
   * `NotaMinted` event.
   *
   * The configured signer submits and pays; it need not be the issuer. The
   * record's owner is `issuer.account`, established by `signature`.
   *
   * @throws ConformanceFailedError if a gate rule fails.
   * @throws ContractCallError for any other revert, e.g. a fee the submitter cannot pay.
   */
  async mint(
    draft: NotaDraft,
    signature: NotaSignature | string,
    options: MintOptions = {}
  ): Promise<MintResult> {
    if (!this.write || !this.signer) throw new SignerRequiredError("mint");
    const preflight = await this.check(draft, signature);
    if (!preflight.ok) {
      throw new ConformanceFailedError(preflight.rule ?? 0, preflight.message ?? "the content was refused");
    }
    const args = mintArguments(draft, signature);
    let transactionHash: string;
    try {
      await this.write.mint.staticCall(...args);
      const tx = await this.write.mint(...args);
      transactionHash = tx.hash as string;
    } catch (err) {
      throw callError("mint", err);
    }
    return this.mintedFromTransaction(transactionHash, { ...options, notaId: preflight.notaId });
  }

  /**
   * Waits for a mint transaction to reach the given number of confirmations
   * and writes its `.nota` file from the `NotaMinted` event. This is the last
   * step of the mint flow, exposed for mints sent by something other than
   * this client (a wallet library, a relayer).
   *
   * @throws NotaNotFoundError if the transaction did not mint through this registry.
   */
  async mintedFromTransaction(
    transactionHash: string,
    options: MintOptions & { notaId?: string } = {}
  ): Promise<MintResult> {
    const receipt = await this.waitForReceipt(
      transactionHash,
      options.confirmations ?? this.options.confirmations ?? 1,
      options.timeout
    );
    if (receipt.status !== 1) {
      throw callError("mint", new Error(`transaction ${transactionHash} was mined but reverted`));
    }
    const log = findNotaMintedLog(receipt.logs, this.address, options.notaId);
    if (log === null) {
      throw new NotaNotFoundError(
        options.notaId ?? transactionHash,
        `transaction ${transactionHash} carries no NotaMinted event from ${this.address}`
      );
    }
    const file = await this.fileFromLog(log);
    const nota = readNota(file, { trustedRegistries: [await this.deployment()] });
    return {
      notaId: nota.notaId,
      resourceId: nota.resourceId,
      transactionHash,
      blockNumber: nota.receipt.blockNumber,
      file,
      nota,
      fileName: suggestNotaFileName(nota.content, nota.notaId),
    };
  }

  /**
   * Reconstructs a `.nota` file from the chain, given only its `notaId`: how a
   * lost file is recovered and how a `nota:` reference is resolved. The result
   * is byte-identical to the file the issuer's SDK wrote.
   *
   * @throws NotaNotFoundError if no `NotaMinted` event for the `notaId` is in range.
   */
  async reconstruct(notaId: string, range: LogRange = {}): Promise<Uint8Array> {
    const id = requireBytes32(notaId, "notaId");
    let logs: Log[];
    try {
      logs = await this.provider.getLogs({
        address: this.address,
        topics: [NOTA_MINTED_TOPIC, id],
        fromBlock: range.fromBlock ?? 0,
        toBlock: range.toBlock ?? "latest",
      });
    } catch (err) {
      throw callError("reconstruct", err);
    }
    const log = findNotaMintedLog(logs, this.address, id);
    if (log === null) throw new NotaNotFoundError(id, "no NotaMinted event was found in the block range");
    return this.fileFromLog(log);
  }

  /**
   * Lists `NotaMinted` events, newest first, optionally for one issuer or one
   * resource. Reads logs directly, so the range it can cover is whatever the
   * RPC endpoint allows; this is not an index.
   */
  async listMinted(
    filter: { issuer?: string; resourceId?: string } & LogRange = {}
  ): Promise<MintedNota[]> {
    const issuerTopic = filter.issuer
      ? "0x" + "0".repeat(24) + getAddress(filter.issuer).slice(2).toLowerCase()
      : null;
    const resourceTopic = filter.resourceId ? requireBytes32(filter.resourceId, "resourceId") : null;
    let logs: Log[];
    try {
      logs = await this.provider.getLogs({
        address: this.address,
        topics: [NOTA_MINTED_TOPIC, null, resourceTopic, issuerTopic],
        fromBlock: filter.fromBlock ?? 0,
        toBlock: filter.toBlock ?? "latest",
      });
    } catch (err) {
      throw callError("listMinted", err);
    }
    return logs
      .map((log) => summarizeNotaMintedLog(log))
      .sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
  }

  /**
   * Polls for a receipt until the transaction is `confirmations` blocks deep.
   *
   * This does not use `provider.waitForTransaction`: ethers compares against a
   * block number it caches for a quarter of a second, and then waits for a
   * further block. On a chain that mines only when there is a transaction (a
   * development node) that block may never come.
   */
  private async waitForReceipt(
    transactionHash: string,
    confirmations: number,
    timeout?: number
  ): Promise<TransactionReceipt> {
    const interval = this.options.pollingInterval ?? 1000;
    const deadline = timeout === undefined ? undefined : Date.now() + timeout;
    for (;;) {
      try {
        const receipt = await this.provider.getTransactionReceipt(transactionHash);
        // A receipt is itself one confirmation.
        if (receipt !== null) {
          if (confirmations <= 1) return receipt;
          const latest = await this.provider.getBlock("latest");
          if (latest !== null && latest.number - receipt.blockNumber + 1 >= confirmations) return receipt;
        }
      } catch (err) {
        throw callError("mint", err);
      }
      if (deadline !== undefined && Date.now() >= deadline) {
        throw callError(
          "mint",
          new Error(`transaction ${transactionHash} did not reach ${confirmations} confirmation(s) in ${timeout} ms`)
        );
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  private async fileFromLog(log: Log): Promise<Uint8Array> {
    const registry = await this.deployment();
    const issuer = summarizeNotaMintedLog(log).issuer;
    const block = await this.provider.getBlock(log.blockNumber);
    if (block === null) throw new Error(`block ${log.blockNumber} is not available from the provider`);
    return notaFileFromMintLog(log, {
      registry,
      blockTimestamp: block.timestamp,
      issuerHasCode: await this.hadCode(issuer, log.blockNumber),
    });
  }

  /**
   * Whether the account had code when the file was minted. The gate decides
   * the signature scheme from the code at the mint block, so that block is
   * asked first; a node without historical state answers for the latest one.
   */
  private async hadCode(account: string, blockNumber: number): Promise<boolean> {
    let code: string;
    try {
      code = await this.provider.getCode(account, blockNumber);
    } catch {
      code = await this.provider.getCode(account);
    }
    return code !== "0x";
  }

  // -------------------------------------------------------------------------
  // Records
  // -------------------------------------------------------------------------

  /**
   * The registry's record of a file, or `null` if the `notaId` was never
   * minted. The record's status and level are authoritative (trust rule 5).
   */
  async getNota(notaId: string): Promise<NotaRecord | null> {
    const id = requireBytes32(notaId, "notaId");
    try {
      const r = await this.read.getNota(id);
      if (BigInt(r.mintedAt) === 0n) return null;
      return {
        notaId: id,
        resourceId: (r.resourceId as string).toLowerCase(),
        issuer: getAddress(r.issuer as string),
        metadataHash: (r.metadataHash as string).toLowerCase(),
        supersedes: (r.supersedes as string).toLowerCase(),
        supersededBy: (r.supersededBy as string).toLowerCase(),
        status: Number(r.status),
        level: Number(r.level),
        controlProof: controlProofName(r.controlProof as bigint),
        ruleset: Number(r.ruleset),
        mintedAt: Number(r.mintedAt),
        expiresAt: Number(r.expiresAt),
        updatedAt: Number(r.updatedAt),
      };
    } catch (err) {
      throw callError("getNota", err);
    }
  }

  /**
   * What the registry knows about a resource, or `null` if no file has been
   * minted for it. `canonical` is the VERIFIED, unexpired file that speaks
   * for the resource, or the zero hash.
   */
  async getResource(resourceId: string): Promise<ResourceRecord | null> {
    const id = requireBytes32(resourceId, "resourceId");
    try {
      const r = await this.read.getResource(id);
      const identifierHex = r.identifier as string;
      if (identifierHex === "0x") return null;
      const resourceType = Number(r.resourceType);
      return {
        resourceId: id,
        resourceType,
        typeName: resolveResourceTypeString(resourceType),
        chainId: BigInt(r.chainId),
        identifier: decodeUtf8(hexToBytes(identifierHex)),
        canonical: (r.canonical as string).toLowerCase(),
      };
    } catch (err) {
      throw callError("getResource", err);
    }
  }

  /** The issuer's current file for a resource, or the zero hash. It may have expired. */
  async headOf(resourceId: string, issuer: string): Promise<string> {
    try {
      const id = await this.read.headOf(requireBytes32(resourceId, "resourceId"), getAddress(issuer));
      return (id as string).toLowerCase();
    } catch (err) {
      throw callError("headOf", err);
    }
  }

  /** The VERIFIED, unexpired file that speaks for a resource, or the zero hash. */
  async canonicalOf(resourceId: string): Promise<string> {
    try {
      const id = await this.read.canonicalOf(requireBytes32(resourceId, "resourceId"));
      return (id as string).toLowerCase();
    } catch (err) {
      throw callError("canonicalOf", err);
    }
  }

  /**
   * The file an alias currently points to: the head of the claim it is bound
   * to, or the zero hash. Resolving an alias is not verification; establish
   * the file's status like any other.
   */
  async resolveAlias(alias: string): Promise<string> {
    try {
      return ((await this.read.resolveAlias(alias)) as string).toLowerCase();
    } catch (err) {
      throw callError("resolveAlias", err);
    }
  }

  /** The claim an alias is bound to, or `null` if the alias is unbound. */
  async aliasInfo(alias: string): Promise<AliasBinding | null> {
    try {
      const [info, notaId] = await Promise.all([this.read.aliasInfo(alias), this.read.resolveAlias(alias)]);
      const owner = info.owner as string;
      if (/^0x0{40}$/.test(owner)) return null;
      return {
        alias,
        resourceId: (info.resourceId as string).toLowerCase(),
        owner: getAddress(owner),
        notaId: (notaId as string).toLowerCase(),
      };
    } catch (err) {
      throw callError("aliasInfo", err);
    }
  }

  /** True while a file is REGISTERED, PENDING, VERIFIED or DISPUTED and has not expired. */
  async isLive(notaId: string): Promise<boolean> {
    try {
      return (await this.read.isLive(requireBytes32(notaId, "notaId"))) as boolean;
    } catch (err) {
      throw callError("isLive", err);
    }
  }

  /**
   * True when a social verification request may be opened for a file: it is
   * REGISTERED, not expired, its issuer's head, and no other issuer holds the
   * resource's canonical slot.
   */
  async isVerifiable(notaId: string): Promise<boolean> {
    try {
      return (await this.read.isVerifiable(requireBytes32(notaId, "notaId"))) as boolean;
    } catch (err) {
      throw callError("isVerifiable", err);
    }
  }

  /** True when a live file of another issuer holds the canonical slot of the file's resource. */
  async canonicalHeldByOther(notaId: string): Promise<boolean> {
    try {
      return (await this.read.canonicalHeldByOther(requireBytes32(notaId, "notaId"))) as boolean;
    } catch (err) {
      throw callError("canonicalHeldByOther", err);
    }
  }

  /**
   * Revokes a file. Only the issuer may revoke, and only while the file is
   * REGISTERED or VERIFIED. Revocation marks the record; it does not erase it.
   *
   * @returns The transaction hash.
   */
  async revoke(notaId: string): Promise<string> {
    if (!this.write) throw new SignerRequiredError("revoke");
    const id = requireBytes32(notaId, "notaId");
    try {
      await this.write.revoke.staticCall(id);
      const tx = await this.write.revoke(id);
      return tx.hash as string;
    } catch (err) {
      throw callError("revoke", err);
    }
  }

  // -------------------------------------------------------------------------
  // Identifiers
  // -------------------------------------------------------------------------

  /** `notaId` of a content layer under this registry's EIP-712 domain, computed locally. */
  async computeNotaId(content: NotaContent): Promise<string> {
    return computeNotaId(content, await this.deployment());
  }

  /** `notaId` as the registry itself computes it (`hashNota`). Agrees with {@link computeNotaId}. */
  async hashNota(content: NotaContent): Promise<string> {
    try {
      return ((await this.read.hashNota(toNotaStruct(content))) as string).toLowerCase();
    } catch (err) {
      throw callError("hashNota", err);
    }
  }

  /**
   * `resourceId` of a resource, computed locally:
   * `keccak256(abi.encodePacked(uint8(resourceType), uint256(chainId), bytes(identifier)))`.
   * Accepts governance-added type IDs (0 through 254).
   */
  computeResourceId(resourceType: number, chainId: number | bigint, identifier: string): string {
    if (!Number.isInteger(resourceType) || resourceType < 0 || resourceType > 254) {
      throw new RangeError(`resourceType must be an integer from 0 to 254, got ${resourceType}`);
    }
    if (identifier === "") throw new RangeError("identifier must not be empty");
    return keccak256(
      solidityPacked(["uint8", "uint256", "bytes"], [resourceType, BigInt(chainId), encodeUtf8(identifier)])
    );
  }

  /** `resourceId` as the registry computes it. Agrees with {@link computeResourceId}. */
  async computeResourceIdOnChain(
    resourceType: number,
    chainId: number | bigint,
    identifier: string
  ): Promise<string> {
    try {
      const id = await this.read.computeResourceId(resourceType, BigInt(chainId), encodeUtf8(identifier));
      return (id as string).toLowerCase();
    } catch (err) {
      throw callError("computeResourceId", err);
    }
  }

  // -------------------------------------------------------------------------
  // Fees
  // -------------------------------------------------------------------------

  /** Fee charged to the submitter of every mint, in NOTA (18 decimals). */
  async mintFee(): Promise<bigint> {
    try {
      return BigInt(await this.read.mintFee());
    } catch (err) {
      throw callError("mintFee", err);
    }
  }

  /** Fee charged when a mint binds a new alias, in NOTA (18 decimals). */
  async aliasFee(): Promise<bigint> {
    try {
      return BigInt(await this.read.aliasFee());
    } catch (err) {
      throw callError("aliasFee", err);
    }
  }

  // -------------------------------------------------------------------------
  // Resource types
  // -------------------------------------------------------------------------

  /**
   * Add a new resource type (governance).
   * Matches: addResourceType(uint8 typeId, string name)
   */
  async addResourceType(typeId: number, name: string): Promise<string> {
    if (!this.write) throw new SignerRequiredError("addResourceType");
    try {
      const tx = await this.write.addResourceType(typeId, name);
      return tx.hash as string;
    } catch (err) {
      throw callError("addResourceType", err);
    }
  }

  /**
   * Remove a resource type (governance).
   * Matches: removeResourceType(uint8 typeId)
   */
  async removeResourceType(typeId: number): Promise<string> {
    if (!this.write) throw new SignerRequiredError("removeResourceType");
    try {
      const tx = await this.write.removeResourceType(typeId);
      return tx.hash as string;
    } catch (err) {
      throw callError("removeResourceType", err);
    }
  }

  /**
   * Check if a resource type is valid.
   * Matches: validResourceTypes(uint8) returns (bool)
   */
  async isValidResourceType(typeId: number): Promise<boolean> {
    try {
      return (await this.read.validResourceTypes(typeId)) as boolean;
    } catch (err) {
      throw callError("validResourceTypes", err);
    }
  }

  /**
   * Get the name of a resource type.
   * Matches: resourceTypeNames(uint8) returns (string)
   */
  async getResourceTypeName(typeId: number): Promise<string> {
    try {
      return (await this.read.resourceTypeNames(typeId)) as string;
    } catch (err) {
      throw callError("resourceTypeNames", err);
    }
  }
}
