/**
 * SDK error classes for @notareum/sdk.
 */

/** Thrown when a signer is required but not provided. */
export class SignerRequiredError extends Error {
  constructor(method: string) {
    super(`Signer is required for write operation: ${method}`);
    this.name = "SignerRequiredError";
  }
}

/** Thrown when a contract call fails. */
export class ContractCallError extends Error {
  public readonly contractMethod: string;
  /** Name of the custom error the contract reverted with, when it could be decoded. */
  public readonly revertName: string | undefined;
  /** Arguments of that custom error. */
  public readonly revertArgs: readonly unknown[] | undefined;
  constructor(
    method: string,
    cause: unknown,
    revert?: { name: string; args: readonly unknown[] }
  ) {
    const msg = revert
      ? `reverted with ${revert.name}(${revert.args.map((a) => String(a)).join(", ")})`
      : cause instanceof Error
        ? cause.message
        : String(cause);
    super(`Contract call failed [${method}]: ${msg}`, { cause });
    this.name = "ContractCallError";
    this.contractMethod = method;
    this.revertName = revert?.name;
    this.revertArgs = revert?.args;
  }
}

/**
 * The Conformance Gate, or the registry's own state rules, refused a mint:
 * the contract reverted with `ConformanceFailed(rule)`.
 */
export class ConformanceFailedError extends Error {
  /** 1 (G1) through 13 (G13). */
  public readonly rule: number;
  /** `"G1"` through `"G13"`. */
  public readonly ruleId: string;
  /** What the rule requires. */
  public readonly requirement: string;
  constructor(rule: number, requirement: string) {
    super(`Conformance Gate rule G${rule} failed: ${requirement}`);
    this.name = "ConformanceFailedError";
    this.rule = rule;
    this.ruleId = `G${rule}`;
    this.requirement = requirement;
  }
}

/** Thrown when an invalid configuration is provided. */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** Thrown when a resource is not found. */
export class ResourceNotFoundError extends Error {
  public readonly resourceId: string;
  constructor(resourceId: string) {
    super(`Resource not found: ${resourceId}`);
    this.name = "ResourceNotFoundError";
    this.resourceId = resourceId;
  }
}

/** Thrown when the registry has no record, or no `NotaMinted` event, for a `notaId`. */
export class NotaNotFoundError extends Error {
  public readonly notaId: string;
  constructor(notaId: string, detail = "the registry has no record of it") {
    super(`.nota file ${notaId} not found: ${detail}`);
    this.name = "NotaNotFoundError";
    this.notaId = notaId;
  }
}

/**
 * A `.nota` file names a registry deployment that is not on the reader's
 * pinned list (trust rule 4). The file is refused: a reader must not query,
 * or extend trust to, a registry merely because a file names it.
 */
export class UntrustedRegistryError extends Error {
  /** The deployment the file's receipt names. */
  public readonly registry: { chainId: number; address: string };
  constructor(registry: { chainId: number; address: string }) {
    super(
      `The file was minted on a registry this reader does not trust (chain ${registry.chainId}, ${registry.address}).`
    );
    this.name = "UntrustedRegistryError";
    this.registry = registry;
  }
}
