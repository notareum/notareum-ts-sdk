/**
 * Shared plumbing for the contract clients: one set of custom errors for
 * decoding reverts, and the translation of a failed call into an SDK error.
 */

import { Contract, Interface } from "ethers";
import type { ContractRunner, InterfaceAbi, JsonFragment } from "ethers";
import {
  NotareumAccessManagerABI,
  NotareumConformanceGateABI,
  NotareumFeeManagerABI,
  NotareumNOTATokenABI,
  NotareumNotaRegistryABI,
  NotareumSlashingManagerABI,
  NotareumValidatorStakingABI,
  NotareumVeNOTAABI,
  NotareumVerificationEngineABI,
} from "../abi/index.js";
import { ConformanceFailedError, ContractCallError } from "../errors.js";
import { describeGateRule } from "../mint.js";

/**
 * Every custom error any protocol contract can raise. A call into one
 * contract can revert with another's error (the registry surfaces the token's
 * `ERC20InsufficientAllowance` when a mint fee cannot be collected), so each
 * client decodes against all of them.
 */
const PROTOCOL_ERRORS: JsonFragment[] = (() => {
  const seen = new Set<string>();
  const errors: JsonFragment[] = [];
  const abis: ReadonlyArray<ReadonlyArray<JsonFragment>> = [
    NotareumNotaRegistryABI,
    NotareumConformanceGateABI,
    NotareumVerificationEngineABI,
    NotareumValidatorStakingABI,
    NotareumSlashingManagerABI,
    NotareumFeeManagerABI,
    NotareumNOTATokenABI,
    NotareumVeNOTAABI,
    NotareumAccessManagerABI,
  ];
  for (const abi of abis) {
    for (const fragment of abi) {
      if (fragment.type !== "error") continue;
      const key = `${fragment.name}(${(fragment.inputs ?? []).map((i) => i.type).join(",")})`;
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push(fragment);
    }
  }
  return errors;
})();

const errorInterface = new Interface(PROTOCOL_ERRORS);

/** A contract whose interface can decode every protocol error. */
export function protocolContract(
  address: string,
  abi: ReadonlyArray<JsonFragment>,
  runner: ContractRunner
): Contract {
  const own = new Set(
    abi.filter((f) => f.type === "error").map((f) => `${f.name}(${(f.inputs ?? []).map((i) => i.type).join(",")})`)
  );
  const extra = PROTOCOL_ERRORS.filter(
    (f) => !own.has(`${f.name}(${(f.inputs ?? []).map((i) => i.type).join(",")})`)
  );
  return new Contract(address, [...abi, ...extra] as InterfaceAbi, runner);
}

export interface DecodedRevert {
  name: string;
  args: readonly unknown[];
}

function revertData(err: unknown): string | undefined {
  // ethers puts the return data on the error; wallets and some nodes nest it.
  const seen = new Set<unknown>();
  const queue: unknown[] = [err];
  while (queue.length > 0) {
    const current = queue.shift();
    if (typeof current !== "object" || current === null || seen.has(current)) continue;
    seen.add(current);
    const candidate = current as Record<string, unknown>;
    if (typeof candidate.data === "string" && /^0x[0-9a-fA-F]{8,}$/.test(candidate.data)) {
      return candidate.data;
    }
    queue.push(candidate.data, candidate.error, candidate.info, candidate.cause);
  }
  return undefined;
}

/** The custom error a failed call reverted with, when it is one of the protocol's. */
export function decodeRevert(err: unknown): DecodedRevert | null {
  const revert = (err as { revert?: { name?: string; args?: Iterable<unknown> } | null } | null)?.revert;
  if (revert && typeof revert.name === "string") {
    return { name: revert.name, args: revert.args ? [...revert.args] : [] };
  }
  const data = revertData(err);
  if (data === undefined) return null;
  try {
    const parsed = errorInterface.parseError(data);
    return parsed === null ? null : { name: parsed.name, args: [...parsed.args] };
  } catch {
    return null;
  }
}

/**
 * Translates a failed call. `ConformanceFailed(rule)` becomes a
 * {@link ConformanceFailedError}; anything else a {@link ContractCallError}
 * carrying the decoded revert when there is one.
 */
export function callError(method: string, err: unknown): Error {
  if (err instanceof ConformanceFailedError || err instanceof ContractCallError) return err;
  const revert = decodeRevert(err);
  if (revert !== null && revert.name === "ConformanceFailed") {
    const rule = Number(revert.args[0]);
    return new ConformanceFailedError(rule, describeGateRule(rule));
  }
  return new ContractCallError(method, err, revert ?? undefined);
}
