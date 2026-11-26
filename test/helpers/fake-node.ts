/**
 * A JSON-RPC node for tests, with contracts whose behaviour is written in
 * TypeScript but whose interface is the real ABI.
 *
 * Every call a client makes is encoded by ethers against the ABI the SDK
 * ships, decoded here against the same ABI, and answered through it. A client
 * that calls a function the contract does not have, or passes arguments in
 * the wrong shape, fails here the way it would against a deployment.
 */

import {
  Interface,
  JsonRpcProvider,
  Transaction,
  getAddress,
  keccak256,
  toBeHex,
  toQuantity,
  zeroPadValue,
} from "ethers";
import type { InterfaceAbi, JsonRpcError, JsonRpcPayload, JsonRpcResult, Result } from "ethers";

export const CHAIN_ID = 31337;

/** A custom error to revert with, encoded against an ABI. */
export class Revert extends Error {
  constructor(public readonly data: string) {
    super("execution reverted");
  }
}

export interface CallContext {
  /** `msg.sender`. The zero address for an unsigned read. */
  from: string;
  /** True for a transaction, false for `eth_call` and `eth_estimateGas`. */
  mutating: boolean;
  /** `block.timestamp` of the block the call runs in. */
  timestamp: number;
  /** Emits an event from the called contract. Recorded only when the call is a mined transaction. */
  emit(eventName: string, args: unknown[]): void;
}

export type Handler = (args: Result, context: CallContext) => unknown;

interface FakeContract {
  address: string;
  iface: Interface;
  handlers: Record<string, Handler>;
}

interface StoredLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
}

export interface RecordedCall {
  to: string;
  name: string;
  args: unknown[];
  from: string;
  mutating: boolean;
}

const ZERO_ADDRESS = "0x" + "0".repeat(40);

function blockHash(number: number): string {
  return keccak256(toBeHex(number, 32));
}

export class FakeNode extends JsonRpcProvider {
  /** Number of the latest block. */
  public height = 100;
  /** Timestamp of the latest block. */
  public timestamp = 1_800_000_000;
  /** Seconds between blocks. */
  public blockTime = 12;
  /** Every decoded call, in order. */
  public readonly calls: RecordedCall[] = [];
  /** When set, every request fails with this message, as an unreachable endpoint would. */
  public offline: string | null = null;

  private readonly contracts = new Map<string, FakeContract>();
  private readonly code = new Map<string, string>();
  private readonly nonces = new Map<string, number>();
  private readonly receipts = new Map<string, Record<string, unknown>>();
  private readonly logs: StoredLog[] = [];
  private readonly blockTimes = new Map<number, number>();

  /**
   * @param cacheTimeout - ethers' response cache in milliseconds. Disabled by
   *   default so that tests see every state change at once; pass 250 for the
   *   behaviour of a stock JsonRpcProvider.
   */
  constructor(cacheTimeout = -1) {
    super(undefined, CHAIN_ID, { staticNetwork: true, batchMaxCount: 1, cacheTimeout });
    this.pollingInterval = 5;
    this.blockTimes.set(this.height, this.timestamp);
  }

  /** Installs a contract at an address. */
  deploy(address: string, abi: InterfaceAbi, handlers: Record<string, Handler>): Interface {
    const iface = new Interface(abi);
    for (const name of Object.keys(handlers)) {
      if (iface.getFunction(name) === null) throw new Error(`handler "${name}" is not a function of the ABI`);
    }
    const checksummed = getAddress(address);
    this.contracts.set(checksummed.toLowerCase(), { address: checksummed, iface, handlers });
    this.code.set(checksummed.toLowerCase(), "0x6001");
    return iface;
  }

  /** Marks an account as having code (a contract account) without behaviour. */
  setCode(address: string, code = "0x6001"): void {
    this.code.set(address.toLowerCase(), code);
  }

  /** Mines empty blocks. */
  mine(blocks = 1): void {
    for (let i = 0; i < blocks; i++) {
      this.height += 1;
      this.timestamp += this.blockTime;
      this.blockTimes.set(this.height, this.timestamp);
    }
  }

  /** Calls a function of the ABI was asked for, by name. */
  callsTo(name: string): RecordedCall[] {
    return this.calls.filter((c) => c.name === name);
  }

  // -------------------------------------------------------------------------
  // JSON-RPC
  // -------------------------------------------------------------------------

  override async _send(payload: JsonRpcPayload | Array<JsonRpcPayload>): Promise<Array<JsonRpcResult>> {
    const list = Array.isArray(payload) ? payload : [payload];
    const responses: Array<JsonRpcResult | JsonRpcError> = list.map((request) => {
      try {
        if (this.offline !== null) throw new Error(this.offline);
        return { id: request.id, result: this.rpc(request.method, request.params as unknown[]) };
      } catch (err) {
        if (err instanceof Revert) {
          return { id: request.id, error: { code: 3, message: "execution reverted", data: err.data } };
        }
        return { id: request.id, error: { code: -32603, message: (err as Error).message } };
      }
    });
    // JsonRpcProvider declares only results, but its caller handles error responses too.
    return responses as Array<JsonRpcResult>;
  }

  private rpc(method: string, params: unknown[]): unknown {
    switch (method) {
      case "eth_chainId":
        return toQuantity(CHAIN_ID);
      case "eth_blockNumber":
        return toQuantity(this.height);
      case "eth_getBlockByNumber":
        return this.block(params[0] as string);
      case "eth_getCode":
        return this.code.get((params[0] as string).toLowerCase()) ?? "0x";
      case "eth_getTransactionCount":
        return toQuantity(this.nonces.get((params[0] as string).toLowerCase()) ?? 0);
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas":
        return toQuantity(1_000_000_000);
      case "eth_estimateGas":
        this.execute(params[0] as { to?: string; data?: string; from?: string }, false);
        return toQuantity(200_000);
      case "eth_call":
        return this.execute(params[0] as { to?: string; data?: string; from?: string }, false);
      case "eth_sendRawTransaction":
        return this.sendRaw(params[0] as string);
      case "eth_getTransactionReceipt":
        return this.receipts.get(params[0] as string) ?? null;
      case "eth_getLogs":
        return this.getLogsRpc(params[0] as Record<string, unknown>);
      default:
        throw new Error(`FakeNode does not implement ${method}`);
    }
  }

  private block(tag: string): Record<string, unknown> | null {
    let number: number;
    let timestamp: number;
    if (tag === "pending") {
      number = this.height + 1;
      timestamp = this.timestamp + this.blockTime;
    } else {
      number = tag === "latest" ? this.height : Number(BigInt(tag));
      const known = this.blockTimes.get(number);
      if (number > this.height) return null;
      timestamp = known ?? this.timestamp - (this.height - number) * this.blockTime;
    }
    return {
      hash: tag === "pending" ? null : blockHash(number),
      parentHash: blockHash(number - 1),
      number: toQuantity(number),
      timestamp: toQuantity(timestamp),
      nonce: "0x0000000000000000",
      difficulty: "0x0",
      gasLimit: toQuantity(30_000_000),
      gasUsed: "0x0",
      miner: ZERO_ADDRESS,
      extraData: "0x",
      baseFeePerGas: null,
      transactions: [],
    };
  }

  private execute(
    call: { to?: string; data?: string; input?: string; from?: string },
    mutating: boolean,
    emitted?: Array<{ address: string; topics: string[]; data: string }>,
    timestamp = this.timestamp + this.blockTime
  ): string {
    const to = (call.to ?? "").toLowerCase();
    const data = call.data ?? call.input ?? "0x";
    const contract = this.contracts.get(to);
    // A call to an address without code succeeds and returns nothing, as on a real chain.
    if (contract === undefined) return "0x";
    const fragment = contract.iface.getFunction(data.slice(0, 10));
    if (fragment === null) throw new Revert("0x");
    const handler = contract.handlers[fragment.name];
    if (handler === undefined) {
      throw new Error(`FakeNode: no handler for ${fragment.name} on ${contract.address}`);
    }
    const args = contract.iface.decodeFunctionData(fragment, data);
    const from = call.from ? getAddress(call.from) : ZERO_ADDRESS;
    this.calls.push({ to: contract.address, name: fragment.name, args: args.toArray(true), from, mutating });
    const result = handler(args, {
      from,
      mutating,
      timestamp,
      emit: (eventName, eventArgs) => {
        const event = contract.iface.getEvent(eventName);
        if (event === null) throw new Error(`"${eventName}" is not an event of the ABI`);
        const encoded = contract.iface.encodeEventLog(event, eventArgs);
        emitted?.push({ address: contract.address, topics: encoded.topics, data: encoded.data });
      },
    });
    if (fragment.outputs.length === 0) return "0x";
    const values = fragment.outputs.length === 1 ? [result] : (result as unknown[]);
    return contract.iface.encodeFunctionResult(fragment, values);
  }

  private sendRaw(raw: string): string {
    const tx = Transaction.from(raw);
    const from = tx.from as string;
    const hash = tx.hash as string;
    const emitted: Array<{ address: string; topics: string[]; data: string }> = [];
    const timestamp = this.timestamp + this.blockTime;
    // A transaction that reverts is refused here, as a node refuses it at estimation.
    this.execute({ to: tx.to ?? undefined, data: tx.data, from }, true, emitted, timestamp);

    this.height += 1;
    this.timestamp = timestamp;
    this.blockTimes.set(this.height, this.timestamp);
    this.nonces.set(from.toLowerCase(), (this.nonces.get(from.toLowerCase()) ?? 0) + 1);

    const base = {
      blockNumber: this.height,
      blockHash: blockHash(this.height),
      transactionHash: hash,
      transactionIndex: 0,
    };
    // Start the log index above zero, so that a client which ignores it is caught.
    const logs: StoredLog[] = emitted.map((log, i) => ({ ...log, ...base, logIndex: i + 2 }));
    this.logs.push(...logs);
    this.receipts.set(hash, {
      to: tx.to,
      from,
      contractAddress: null,
      transactionIndex: "0x0",
      gasUsed: toQuantity(100_000),
      cumulativeGasUsed: toQuantity(100_000),
      effectiveGasPrice: toQuantity(1_000_000_000),
      logsBloom: "0x" + "00".repeat(256),
      blockHash: base.blockHash,
      transactionHash: hash,
      blockNumber: toQuantity(this.height),
      status: "0x1",
      type: "0x0",
      logs: logs.map((log) => this.rpcLog(log)),
    });
    return hash;
  }

  private rpcLog(log: StoredLog): Record<string, unknown> {
    return {
      address: log.address,
      topics: log.topics,
      data: log.data,
      blockNumber: toQuantity(log.blockNumber),
      blockHash: log.blockHash,
      transactionHash: log.transactionHash,
      transactionIndex: toQuantity(log.transactionIndex),
      logIndex: toQuantity(log.logIndex),
      removed: false,
    };
  }

  private getLogsRpc(filter: Record<string, unknown>): unknown[] {
    const bound = (value: unknown, fallback: number): number =>
      value === undefined || value === "latest" || value === "pending"
        ? fallback
        : value === "earliest"
          ? 0
          : Number(BigInt(value as string));
    const from = bound(filter.fromBlock, this.height);
    const to = bound(filter.toBlock, this.height);
    const address = typeof filter.address === "string" ? filter.address.toLowerCase() : undefined;
    const topics = (filter.topics ?? []) as Array<string | string[] | null>;
    return this.logs
      .filter((log) => log.blockNumber >= from && log.blockNumber <= to)
      .filter((log) => address === undefined || log.address.toLowerCase() === address)
      .filter((log) =>
        topics.every((wanted, i) => {
          if (wanted === null || wanted === undefined) return true;
          const options = (Array.isArray(wanted) ? wanted : [wanted]).map((t) => t.toLowerCase());
          return log.topics[i] !== undefined && options.includes(log.topics[i].toLowerCase());
        })
      )
      .map((log) => this.rpcLog(log));
  }
}

/** An address as a 32-byte topic. */
export function addressTopic(address: string): string {
  return zeroPadValue(address, 32).toLowerCase();
}
